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
