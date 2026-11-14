// Drafts stay on this device and are isolated by the signed-in account.
const keyFor = (userId) => `limoninior.drafts.${userId}`;
const validEntry = ([id, text]) => Number.isSafeInteger(id) && id > 0
  && typeof text === 'string' && text.length > 0 && text.length <= 4096;

export function loadDrafts(userId, storage) {
  if (!Number.isSafeInteger(userId) || userId <= 0) return new Map();
  try {
    const entries = JSON.parse((storage || localStorage).getItem(keyFor(userId)) || '[]');
    return new Map(Array.isArray(entries)
      ? entries.filter((entry) => Array.isArray(entry) && entry.length === 2 && validEntry(entry)) : []);
  } catch { return new Map(); }
}

export function persistDrafts(userId, drafts, storage) {
  if (!Number.isSafeInteger(userId) || userId <= 0) return;
  try {
    const target = storage || localStorage;
    // Negative keys hold the temporary composer value during message editing.
    const entries = [...drafts].filter(validEntry);
    if (entries.length) target.setItem(keyFor(userId), JSON.stringify(entries));
    else target.removeItem(keyFor(userId));
  } catch { /* Full or unavailable storage must never interrupt typing/sending. */ }
}
