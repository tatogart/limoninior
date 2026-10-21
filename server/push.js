import webpush from 'web-push';
import { config } from './config.js';
import { q, now, kvGet, kvSet } from './db.js';

// VAPID keys are generated once and kept in the database — nothing to configure by hand.
let keys = kvGet('vapid_keys');
if (keys) {
  keys = JSON.parse(keys);
} else {
  keys = webpush.generateVAPIDKeys();
  kvSet('vapid_keys', JSON.stringify(keys));
}
const subject = config.appOrigin.startsWith('https://') ? config.appOrigin : 'mailto:admin@example.com';
webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

export const vapidPublicKey = keys.publicKey;

export function saveSubscription(userId, sub) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    throw Object.assign(new Error('bad_subscription'), { status: 400 });
  }
  q(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(userId, endpoint, p256dh, auth, now());
  // Keep the newest 10 devices per user.
  q(`DELETE FROM push_subs WHERE user_id = ? AND id NOT IN (SELECT id FROM push_subs WHERE user_id = ? ORDER BY id DESC LIMIT 10)`).run(userId, userId);
}

export function removeSubscription(userId, endpoint) {
  q('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?').run(userId, String(endpoint || ''));
}

/** Fire-and-forget push to every device of the given users. */
export function sendPush(userIds, payload, { ttl = 3600, urgency = 'normal' } = {}) {
  if (!userIds.length) return;
  const body = JSON.stringify(payload);
  for (const uid of new Set(userIds)) {
    for (const s of q('SELECT * FROM push_subs WHERE user_id = ?').all(uid)) {
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: ttl, urgency })
        .catch((err) => {
          if (err?.statusCode === 404 || err?.statusCode === 410) q('DELETE FROM push_subs WHERE id = ?').run(s.id);
        });
    }
  }
}
