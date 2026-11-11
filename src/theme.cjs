const luminance = rgb => rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
function chooseUserColor(fg, bg) {
  if (!fg || !bg) return null;
  const candidates = [[0,255,255],[100,170,255],[225,120,255],[255,195,85],[100,240,145],[0,65,120],[90,0,120],[0,90,60],[120,45,0],[0,0,35],[255,255,235],[0,0,0],[255,255,255]];
  return candidates.filter(color => contrast(color, bg) >= 4.5).sort((a, b) => {
    const distance = color => color.reduce((sum, n, i) => sum + (n - fg[i]) ** 2, 0);
    return distance(b) - distance(a);
  })[0] || null;
}

class TerminalTheme {
  constructor({ output = () => {}, forward = () => {}, changed = () => {}, enabled = true } = {}) {
    this.output = output; this.forward = forward; this.changed = changed; this.enabled = enabled;
    this.colors = {}; this.childQueries = new Set(); this.deadline = 0;
  }
  get accent() { return this.enabled ? chooseUserColor(this.colors[10], this.colors[11]) : null; }
  get expecting() { return Date.now() < this.deadline; }
  query(slot, child = false) {
    if (![10, 11].includes(slot)) return;
    if (child && this.colors[slot]) { this.forward(this.report(slot)); return; }
    if (child) this.childQueries.add(slot);
    this.deadline = Date.now() + 1000;
    this.output('\x1b]' + slot + ';?\x1b\\');
  }
  report(slot) { return '\x1b]' + slot + ';rgb:' + this.colors[slot].map(n => n.toString(16).padStart(2, '0')).join('/') + '\x1b\\'; }
  consume(sequence) {
    const match = /^\x1b\](10|11);rgb:([\da-f]{1,4})\/([\da-f]{1,4})\/([\da-f]{1,4})(?:\x07|\x1b\\)$/i.exec(sequence);
    if (!match) return false;
    const slot = Number(match[1]);
    this.colors[slot] = match.slice(2).map(hex => Math.floor(parseInt(hex, 16) * 255 / (16 ** hex.length - 1)));
    if (this.childQueries.delete(slot)) this.forward(this.report(slot));
    this.changed(); return true;
  }
}

module.exports = { TerminalTheme, chooseUserColor, contrast };
