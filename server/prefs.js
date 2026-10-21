// Per-user notification and privacy preferences (stored as JSON in users.prefs).
export const DEFAULT_PREFS = {
  notifyPrivate: true,
  notifyGroups: true,
  notifyChannels: true,
  notifyCalls: true,
  pushPreview: true,
  lastSeen: 'all', // 'all' | 'nobody'
  calls: 'all', // 'all' | 'contacts' | 'nobody'
};

export const PROFILE_COLORS = ['lime', 'ocean', 'sunset', 'berry', 'violet', 'mint', 'gold', 'night'];

export function getPrefs(u) {
  let p = {};
  try { p = JSON.parse(u?.prefs || '{}'); } catch { /* ignore */ }
  return { ...DEFAULT_PREFS, ...p };
}

/** Validate a partial prefs update; unknown keys and bad values are dropped. */
export function cleanPrefs(input) {
  const out = {};
  for (const k of ['notifyPrivate', 'notifyGroups', 'notifyChannels', 'notifyCalls', 'pushPreview']) {
    if (typeof input?.[k] === 'boolean') out[k] = input[k];
  }
  if (['all', 'nobody'].includes(input?.lastSeen)) out.lastSeen = input.lastSeen;
  if (['all', 'contacts', 'nobody'].includes(input?.calls)) out.calls = input.calls;
  return out;
}
