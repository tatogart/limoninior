// Social extras: themes sent to chats (one tap to apply).
import rateLimit from 'express-rate-limit';

const HEX = /^#[0-9a-f]{6}$/i;
const FONTS = new Set(['system', 'rounded', 'serif', 'mono', 'hand', 'narrow']);
const EFFECTS = new Set(['none', 'snow', 'hearts', 'stars', 'lemons', 'leaves', 'bubbles', 'sakura', 'fire']);

/** Only known fields with safe values: the card is rendered by other people's apps. */
export function cleanTheme(t) {
  if (!t || typeof t !== 'object') return null;
  const col = (v) => (HEX.test(v) ? String(v).toLowerCase() : null);
  const wall = (Array.isArray(t.wall) ? t.wall : []).slice(0, 4).map(col).filter(Boolean);
  if (wall.length < 2 || !col(t.accent)) return null;
  return {
    id: /^[a-z0-9-]{1,40}$/.test(t.id) ? t.id : 'shared',
    name: String(t.name || 'Тема').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 30) || 'Тема',
    emoji: [...String(t.emoji || '🎨')].slice(0, 2).join(''),
    base: t.base === 'dark' ? 'dark' : 'light',
    accent: col(t.accent), accent2: col(t.accent2) || col(t.accent), wall,
    bubble: col(t.bubble), bg: col(t.bg), bg2: col(t.bg2),
    radius: Math.min(28, Math.max(2, Math.round(Number(t.radius) || 18))),
    font: FONTS.has(t.font) ? t.font : 'system',
    effect: EFFECTS.has(t.effect) ? t.effect : 'none',
    pattern: !!t.pattern,
  };
}

export function registerSocial(api, { bad, int, isMember, postError, postMessage }) {
  const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });

  api.post('/chats/:id/theme', limiter, (req, res) => {
    const id = int(req.params.id);
    if (!id || !isMember(id, req.user.id)) return bad(res, 'not_found', 404);
    const e = postError(id, req.user.id);
    if (e) return bad(res, e, 403);
    const theme = cleanTheme(req.body?.theme);
    if (!theme) return bad(res, 'bad_theme');
    res.json({ message: postMessage(id, req.user.id, { kind: 'theme', text: theme.name, extra: { theme } }) });
  });
}
