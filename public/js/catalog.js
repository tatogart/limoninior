// Shared catalog of stickers and gifts — imported by both the server and the client.

export const STICKER_PACKS = [
  {
    id: 'lemon',
    title: 'Лимончик',
    type: 'svg',
    stickers: ['hi', 'love', 'lol', 'cool', 'ok', 'thanks', 'wow', 'cry', 'angry', 'sleep', 'kiss', 'think', 'party', 'fire', 'bye', 'yes'],
  },
  {
    id: 'anim',
    title: 'Живые эмодзи',
    type: 'emoji',
    stickers: [
      ['love', '❤️', 'beat'], ['lol', '😂', 'shake'], ['fire', '🔥', 'flicker'], ['wow', '😮', 'pop'],
      ['party', '🎉', 'party'], ['cool', '😎', 'bob'], ['cry', '😭', 'shake'], ['clap', '👏', 'beat'],
      ['rocket', '🚀', 'fly'], ['ghost', '👻', 'float'], ['star', '🌟', 'spin'], ['angry', '😡', 'shake'],
      ['think', '🤔', 'tilt'], ['wave', '👋', 'wave'], ['hundred', '💯', 'pop'], ['lemon', '🍋', 'spin'],
    ],
  },
];

const VALID_STICKERS = new Set(STICKER_PACKS.flatMap((p) => p.stickers.map((s) => `${p.id}/${Array.isArray(s) ? s[0] : s}`)));
export const isValidSticker = (id) => VALID_STICKERS.has(id);

export function stickerInfo(id) {
  const [packId, key] = String(id).split('/');
  const pack = STICKER_PACKS.find((p) => p.id === packId);
  if (!pack) return null;
  if (pack.type === 'svg') return pack.stickers.includes(key) ? { type: 'svg', src: `/stickers/${packId}/${key}.svg` } : null;
  const s = pack.stickers.find((x) => x[0] === key);
  return s ? { type: 'emoji', emoji: s[1], anim: s[2] } : null;
}

export const GIFTS = [
  { id: 'lemon', emoji: '🍋', name: 'Лимончик', price: 5, colors: ['#fff59a', '#f7cf2c'] },
  { id: 'heart', emoji: '❤️', name: 'Сердечко', price: 10, colors: ['#ffb3c1', '#ff4d6d'] },
  { id: 'bear', emoji: '🧸', name: 'Мишка', price: 15, colors: ['#f6d5b0', '#c98b55'] },
  { id: 'rose', emoji: '🌹', name: 'Роза', price: 25, colors: ['#ff9aa8', '#d7263d'] },
  { id: 'gift', emoji: '🎁', name: 'Сюрприз', price: 30, colors: ['#b8e0ff', '#3a8dde'] },
  { id: 'cake', emoji: '🎂', name: 'Торт', price: 50, colors: ['#ffd6e8', '#f472b6'] },
  { id: 'flowers', emoji: '💐', name: 'Букет', price: 75, colors: ['#e9d5ff', '#a855f7'] },
  { id: 'cup', emoji: '🏆', name: 'Кубок', price: 100, colors: ['#fff1a8', '#e0a800'] },
  { id: 'rocket', emoji: '🚀', name: 'Ракета', price: 250, colors: ['#c7d2fe', '#4f46e5'] },
  { id: 'unicorn', emoji: '🦄', name: 'Единорог', price: 300, colors: ['#fbcfe8', '#8b5cf6'] },
  { id: 'diamond', emoji: '💎', name: 'Бриллиант', price: 500, colors: ['#a5f3fc', '#0891b2'] },
  { id: 'crown', emoji: '👑', name: 'Корона', price: 1000, colors: ['#fde68a', '#d97706'] },
];
export const giftById = (id) => GIFTS.find((g) => g.id === id) || null;

export const DAILY_BONUS = 20;
export const START_COINS = 100;

export const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉', '🍋', '🤯', '👎'];

// ---------- subscriptions ----------
export const FREE_FILE_MB = 25;
export const PLANS = [
  {
    id: 'plus', name: 'Limoninior Plus', short: 'Plus', emoji: '⭐', price: 99, colors: ['#ffe27a', '#f5a524'],
    bonusMult: 2, fileMB: 50,
    perks: ['Значок ⭐ рядом с именем', 'Ежедневный бонус ×2', 'Файлы до 50 МБ', 'Поддержка развития Limoninior'],
  },
  {
    id: 'premium', name: 'Limoninior Premium', short: 'Premium', emoji: '💎', price: 249, colors: ['#a5f3fc', '#6366f1'],
    bonusMult: 3, fileMB: 100, popular: true,
    perks: ['Значок 💎 рядом с именем', 'Ежедневный бонус ×3', 'Файлы до 100 МБ', 'Всё из Plus'],
  },
  {
    id: 'max', name: 'Limoninior Max', short: 'Max', emoji: '👑', price: 499, colors: ['#fde68a', '#d946ef'],
    bonusMult: 5, fileMB: 200,
    perks: ['Значок 👑 рядом с именем', 'Ежедневный бонус ×5', 'Файлы до 200 МБ', 'Приоритетная верификация канала', 'Всё из Premium'],
  },
];
export const planById = (id) => PLANS.find((p) => p.id === id) || null;

// ---------- files ----------
/** Extensions that can run code or install software — shown with a warning like in Discord. */
export const DANGEROUS_EXT = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ps1', 'psm1', 'hta', 'cpl',
  'jar', 'apk', 'xapk', 'apks', 'aab', 'ipa', 'dmg', 'pkg', 'app', 'deb', 'rpm', 'sh', 'run', 'bin', 'dll', 'sys', 'drv',
  'lnk', 'reg', 'inf', 'iso', 'img', 'vhd', 'vhdx', 'msc', 'gadget', 'docm', 'xlsm', 'pptm', 'xlam', 'chm', 'appx', 'msix',
]);
export const fileExt = (name) => (String(name).match(/\.([a-z0-9]{1,8})$/i)?.[1] || '').toLowerCase();
export const isDangerousFile = (name) => DANGEROUS_EXT.has(fileExt(name));
