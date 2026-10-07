// Generates the "Лимончик" sticker pack (public/stickers/lemon/*.svg).
// Run: node scripts/gen-stickers.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/stickers/lemon');
fs.mkdirSync(out, { recursive: true });

const INK = '#4a3200';
const LEMON = 'M96 300c-14-30-6-64 14-86 34-60 106-96 178-90 54 4 104 30 134 70 20 8 34 26 32 46-2 16-12 28-26 34-12 62-66 112-138 124-74 12-146-14-182-62-16-4-26-16-24-30 0-4 2-6 12-6z';

const eyes = {
  dot: `<ellipse cx="200" cy="262" rx="15" ry="20" fill="${INK}"/><ellipse cx="312" cy="262" rx="15" ry="20" fill="${INK}"/>
        <circle cx="205" cy="254" r="5" fill="#fff"/><circle cx="317" cy="254" r="5" fill="#fff"/>`,
  happy: `<path d="M180 268q20-26 40 0M292 268q20-26 40 0" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
  closed: `<path d="M180 262q20 18 40 0M292 262q20 18 40 0" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
  heart: `<path d="M200 285c-30-18-40-34-34-48 6-14 26-14 34 2 8-16 28-16 34-2 6 14-4 30-34 48z" fill="#ff3b5c"/>
          <path d="M312 285c-30-18-40-34-34-48 6-14 26-14 34 2 8-16 28-16 34-2 6 14-4 30-34 48z" fill="#ff3b5c"/>
          <circle cx="186" cy="246" r="5" fill="#fff" opacity=".8"/><circle cx="298" cy="246" r="5" fill="#fff" opacity=".8"/>`,
  wink: `<ellipse cx="200" cy="262" rx="15" ry="20" fill="${INK}"/><circle cx="205" cy="254" r="5" fill="#fff"/>
         <path d="M292 266q20-24 40 0" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
  big: `<circle cx="198" cy="258" r="30" fill="#fff" stroke="${INK}" stroke-width="6"/><circle cx="314" cy="258" r="30" fill="#fff" stroke="${INK}" stroke-width="6"/>
        <circle cx="200" cy="262" r="13" fill="${INK}"/><circle cx="312" cy="262" r="13" fill="${INK}"/>`,
  shades: `<path d="M160 240h192v10c0 30-20 46-44 46s-40-16-46-38h-12c-6 22-22 38-46 38s-44-16-44-46z" fill="#16161a"/>
           <path d="M176 252l26-8M292 252l26-8" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".5"/>`,
  sad: `<ellipse cx="200" cy="268" rx="13" ry="17" fill="${INK}"/><ellipse cx="312" cy="268" rx="13" ry="17" fill="${INK}"/>
        <path d="M176 236l40-14M336 236l-40-14" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`,
  angry: `<ellipse cx="200" cy="268" rx="13" ry="16" fill="${INK}"/><ellipse cx="312" cy="268" rx="13" ry="16" fill="${INK}"/>
          <path d="M176 230l46 22M336 230l-46 22" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>`,
  think: `<ellipse cx="200" cy="264" rx="14" ry="18" fill="${INK}"/><ellipse cx="312" cy="264" rx="14" ry="18" fill="${INK}"/>
          <circle cx="206" cy="256" r="5" fill="#fff"/><circle cx="318" cy="256" r="5" fill="#fff"/>
          <path d="M290 222q22-16 46-2" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
          <path d="M178 236h42" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`,
};

const mouths = {
  smile: `<path d="M226 310q30 30 60 0" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
  grin: `<path d="M214 302h84q-4 50-42 50t-42-50z" fill="${INK}"/><path d="M232 334q24-14 48 0q-10 18-24 18t-24-18z" fill="#ff6b81"/>`,
  o: `<ellipse cx="256" cy="324" rx="18" ry="24" fill="${INK}"/>`,
  small: `<ellipse cx="256" cy="318" rx="10" ry="12" fill="${INK}"/>`,
  frown: `<path d="M226 330q30-30 60 0" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
  flat: `<path d="M234 318h44" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
  smirk: `<path d="M228 316q34 16 62-8" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
  kiss: `<path d="M248 300q18 4 4 14q16 6-2 16" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
};

const cheeks = `<ellipse cx="168" cy="300" rx="22" ry="13" fill="#ff8a8a" opacity=".55"/><ellipse cx="344" cy="300" rx="22" ry="13" fill="#ff8a8a" opacity=".55"/>`;

const heartPath = (x, y, s, c = '#ff3b5c') =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 18C-22 4-30-8-26-18c4-10 18-10 26 2 8-12 22-12 26-2 4 10-4 22-26 36z" fill="${c}" stroke="#fff" stroke-width="5"/>`;
const emoji = (ch, x, y, size, rot = 0) =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" transform="rotate(${rot} ${x} ${y})" font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${ch}</text>`;
const tear = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-22c10 14 16 22 16 30a16 16 0 0 1-32 0c0-8 6-16 16-30z" fill="#5ac8fa" stroke="#fff" stroke-width="4"/>`;

const extras = {
  hearts: heartPath(408, 128, 1.1) + heartPath(110, 150, 0.8, '#ff6b8a') + heartPath(430, 230, 0.6, '#ff8fab'),
  tears: tear(150, 300, 1.2) + tear(362, 300, 1.2),
  stream: `<path d="M196 284v80M316 284v80" stroke="#5ac8fa" stroke-width="16" stroke-linecap="round" opacity=".9"/>` + tear(190, 392, 1) + tear(322, 392, 1),
  steam: `<g fill="#fff" stroke="#e0e0e0" stroke-width="4"><circle cx="110" cy="150" r="22"/><circle cx="84" cy="124" r="16"/><circle cx="400" cy="140" r="22"/><circle cx="428" cy="112" r="16"/></g>`,
  zzz: `<g font-family="Arial Black,Arial,sans-serif" font-weight="900" fill="#7aa7ff" stroke="#fff" stroke-width="6" paint-order="stroke">
          <text x="370" y="170" font-size="56">Z</text><text x="414" y="124" font-size="42">z</text><text x="446" y="88" font-size="30">z</text></g>`,
  wow: `<g font-family="Arial Black,Arial,sans-serif" font-weight="900" fill="#ff5b5b" stroke="#fff" stroke-width="7" paint-order="stroke">
          <text x="398" y="150" font-size="88" transform="rotate(12 398 150)">!</text><text x="96" y="160" font-size="72" transform="rotate(-14 96 160)">!</text></g>`,
  question: `<text x="408" y="160" font-size="110" font-family="Arial Black,Arial,sans-serif" font-weight="900" fill="#8e7bff" stroke="#fff" stroke-width="8" paint-order="stroke" transform="rotate(14 408 160)">?</text>`,
  wave: emoji('👋', 410, 200, 96, 18),
  thumb: emoji('👍', 412, 380, 104, -8),
  fire: emoji('🔥', 120, 170, 96, -14) + emoji('🔥', 404, 160, 80, 14),
  party: `<path d="M300 120l58-88 44 104z" fill="#8e7bff" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><circle cx="358" cy="30" r="14" fill="#ffd23f" stroke="#fff" stroke-width="5"/>`
    + `<g stroke="#fff" stroke-width="3"><rect x="90" y="120" width="16" height="26" rx="4" fill="#ff5b8a" transform="rotate(-24 98 133)"/><rect x="420" y="220" width="16" height="26" rx="4" fill="#5ac8fa" transform="rotate(30 428 233)"/>`
    + `<rect x="130" y="70" width="14" height="24" rx="4" fill="#7bd389" transform="rotate(40 137 82)"/><circle cx="450" cy="300" r="10" fill="#ffd23f"/><circle cx="70" cy="240" r="10" fill="#8e7bff"/></g>`,
  sparkle: `<g fill="#fff6b0" stroke="#fff" stroke-width="4"><path d="M420 100l10 26 26 10-26 10-10 26-10-26-26-10 26-10z"/><path d="M96 380l7 18 18 7-18 7-7 18-7-18-18-7 18-7z"/></g>`,
  kissheart: heartPath(390, 300, 0.9),
  angrytint: `<path d="${LEMON}" fill="#ff3b30" opacity=".22"/>`,
};

function caption(text) {
  if (!text) return '';
  const w = Math.max(160, text.length * 34 + 40);
  return `<g transform="translate(256 448) rotate(-4)">
    <rect x="${-w / 2}" y="-36" width="${w}" height="72" rx="36" fill="#fff" stroke="#f0c419" stroke-width="6"/>
    <text y="16" text-anchor="middle" font-size="44" font-weight="900" font-family="Arial Black,Arial,sans-serif" fill="#3a2a00">${text}</text>
  </g>`;
}

function sticker({ eye, mouth, blush = false, extra = [], text = '', tilt = -8 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#fff59a"/><stop offset=".55" stop-color="#ffe03a"/><stop offset="1" stop-color="#f2b705"/></linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity=".22"/></filter>
  </defs>
  ${extra.filter((e) => ['steam'].includes(e)).map((e) => extras[e]).join('')}
  <g transform="translate(256 282) scale(1.08) rotate(${tilt}) translate(-256 -270)">
    <g filter="url(#s)"><path d="${LEMON}" fill="#fff" stroke="#fff" stroke-width="28" stroke-linejoin="round"/></g>
    <path d="${LEMON}" fill="url(#g)" stroke="#e3a600" stroke-width="5"/>
    <path d="M384 128c16-34 50-50 82-44-6 34-36 58-74 56z" fill="#5cc45a" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>
    <path d="M392 134c18-18 38-30 64-40" stroke="#3a9a3a" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="190" cy="176" rx="56" ry="24" fill="#fff" opacity=".5" transform="rotate(-22 190 176)"/>
    ${extra.includes('angrytint') ? extras.angrytint : ''}
    ${blush ? cheeks : ''}
    ${eyes[eye]}
    ${mouths[mouth]}
  </g>
  ${extra.filter((e) => !['steam', 'angrytint'].includes(e)).map((e) => extras[e]).join('')}
  ${caption(text)}
</svg>`;
}

const SET = {
  hi: { eye: 'dot', mouth: 'smile', blush: true, extra: ['wave'], text: 'Привет!' },
  love: { eye: 'heart', mouth: 'smile', blush: true, extra: ['hearts'] },
  lol: { eye: 'happy', mouth: 'grin', blush: true, extra: ['tears'], text: 'АХАХА' },
  cool: { eye: 'shades', mouth: 'smirk', extra: ['sparkle'], tilt: -14 },
  ok: { eye: 'wink', mouth: 'smile', blush: true, extra: ['thumb'], text: 'Ок!' },
  thanks: { eye: 'happy', mouth: 'smile', blush: true, extra: ['hearts'], text: 'Спасибо!' },
  wow: { eye: 'big', mouth: 'o', extra: ['wow'] },
  cry: { eye: 'sad', mouth: 'frown', extra: ['stream'] },
  angry: { eye: 'angry', mouth: 'frown', extra: ['angrytint', 'steam'] },
  sleep: { eye: 'closed', mouth: 'small', blush: true, extra: ['zzz'], tilt: 6 },
  kiss: { eye: 'wink', mouth: 'kiss', blush: true, extra: ['kissheart'] },
  think: { eye: 'think', mouth: 'flat', extra: ['question'], text: 'Хмм…' },
  party: { eye: 'happy', mouth: 'grin', blush: true, extra: ['party'] },
  fire: { eye: 'shades', mouth: 'grin', extra: ['fire'], text: 'ОГОНЬ' },
  bye: { eye: 'happy', mouth: 'smile', blush: true, extra: ['wave'], text: 'Пока!' },
  yes: { eye: 'dot', mouth: 'grin', blush: true, extra: ['thumb', 'sparkle'], text: 'ДА!' },
};

for (const [id, spec] of Object.entries(SET)) fs.writeFileSync(path.join(out, `${id}.svg`), sticker(spec));
console.log(`Generated ${Object.keys(SET).length} stickers in ${out}`);
