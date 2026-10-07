import http from 'node:http';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { q, now } from './db.js';
import { checkOrigin, requireAuth, sessionFromCookie, isAdminUser } from './auth.js';
import { api } from './api.js';
import { admin } from './admin.js';
import { serveMedia } from './media.js';
import { initRealtime } from './realtime.js';

const app = express();
const pub = path.join(config.root, 'public');
const wsOrigin = config.appOrigin.replace(/^http/, 'ws');

app.disable('x-powered-by');
app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
      frameSrc: ['https://accounts.google.com/gsi/'],
      connectSrc: ["'self'", wsOrigin, 'https://accounts.google.com/gsi/'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  // Google sign-in popup needs to talk back to the opener window.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

const globalLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false });

app.use('/api', globalLimiter, checkOrigin, express.json({ limit: '64kb' }), (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/admin', admin);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

app.get('/media/:name', requireAuth, serveMedia);

app.get('/vendor/socket.io.esm.min.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.root, 'node_modules/socket.io/client-dist/socket.io.esm.min.js'));
});

// The admin page is only served to the admin; everyone else gets the normal app.
app.get('/admin', (req, res) => {
  const r = sessionFromCookie(req.headers.cookie);
  res.set('Cache-Control', 'no-store');
  if (r && isAdminUser(r.user) && config.adminTotpSecret) return res.sendFile(path.join(pub, 'admin.html'));
  res.sendFile(path.join(pub, 'index.html'));
});
app.get('/admin.html', (req, res) => res.redirect('/admin'));

app.use(express.static(pub, {
  index: 'index.html',
  setHeaders(res, file) {
    // Icons rarely change; everything else revalidates via ETag so deploys apply instantly.
    res.set('Cache-Control', file.includes(`${path.sep}icons${path.sep}`) ? 'public, max-age=86400' : 'no-cache');
  },
}));

// SPA fallback (e.g. /@username links).
app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) return next();
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(pub, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.status && err.status < 500 ? 'bad_request' : 'server_error' });
});

// Housekeeping: drop expired sessions hourly.
setInterval(() => q('DELETE FROM sessions WHERE expires_at < ?').run(now()), 3600_000).unref();

const server = http.createServer(app);
initRealtime(server);
server.listen(config.port, config.host, () => {
  console.log(`Limoninior listening on http://${config.host}:${config.port} (origin ${config.appOrigin})`);
  if (config.devLogin) console.log('DEV LOGIN is enabled — do not use in production');
  if (!config.adminEmails.length || !config.adminTotpSecret) console.log('Admin panel disabled (set ADMIN_EMAILS and ADMIN_TOTP_SECRET)');
});
