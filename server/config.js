import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no extra dependency). Real env vars take precedence.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  root,
  isProd,
  port: Number(env.PORT || 3000),
  host: env.HOST || '127.0.0.1',
  // Public URL of the app, e.g. https://chat.example.ru — used for Origin checks.
  appOrigin: (env.APP_ORIGIN || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  // Dev login without Google. Never available in production.
  devLogin: !isProd && env.DEV_LOGIN === '1',
  adminEmails: list(env.ADMIN_EMAILS),
  // Password-account usernames allowed into the admin panel (in addition to ADMIN_EMAILS).
  adminUsernames: list(env.ADMIN_USERNAMES),
  // Lets the server request a self-update (picked up by the root update timer).
  updateFlag: '',
  version: '',
  adminTotpSecret: (env.ADMIN_TOTP_SECRET || '').replace(/\s+/g, '').toUpperCase(),
  adminIps: list(env.ADMIN_IPS),
  sessionDays: Number(env.SESSION_DAYS || 60),
  adminSessionMinutes: Number(env.ADMIN_SESSION_MINUTES || 15),
  trustProxy: env.TRUST_PROXY ?? (isProd ? '1' : '0'),
};

if (isProd) {
  if (!config.appOrigin.startsWith('https://')) throw new Error('APP_ORIGIN must be https:// in production');
}

fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });
config.updateFlag = path.join(config.dataDir, 'update-request');
try { config.version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim(); } catch { config.version = 'dev'; }
