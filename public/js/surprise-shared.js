export const SURPRISE_SKINS = Object.freeze({
  lemon: { label: 'Лимонный сад', emoji: '🍋', colors: ['#e1f18a', '#7ed5a5'], ink: '#254c39' },
  space: { label: 'Космическая пыль', emoji: '🪐', colors: ['#4c3b91', '#182b59'], ink: '#ffffff' },
  heart: { label: 'Тёплое послание', emoji: '💌', colors: ['#ffb7c4', '#e7a8e9'], ink: '#673352' },
});

// Small occupancy grid: rubbing the same spot repeatedly does not count as progress.
export class ScratchProgress {
  constructor() { this.cells = new Set(); this.previous = null; }
  begin(x, y) { this.previous = null; return this.move(x, y); }
  end() { this.previous = null; }
  move(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this.ratio;
    const next = { x: Math.max(0, Math.min(300, x)), y: Math.max(0, Math.min(180, y)) };
    const from = this.previous || next;
    const steps = Math.max(1, Math.ceil(Math.hypot(next.x - from.x, next.y - from.y) / 8));
    for (let n = 0; n <= steps; n++) {
      const px = from.x + (next.x - from.x) * n / steps;
      const py = from.y + (next.y - from.y) * n / steps;
      for (let row = 0; row < 15; row++) for (let col = 0; col < 25; col++) {
        if (Math.hypot(col * 12 + 6 - px, row * 12 + 6 - py) <= 24) this.cells.add(row * 25 + col);
      }
    }
    this.previous = next;
    return this.ratio;
  }
  get ratio() { return this.cells.size / 375; }
}
