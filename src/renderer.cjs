const { panelLines } = require('./overlay.cjs');

function style(cell, prompt, accent) {
  if (!cell || cell.isAttributeDefault() && !prompt) return '\x1b[0m';
  const parts = [0];
  if (prompt) parts.push(1);
  for (const [name, code] of [['isBold', 1], ['isDim', 2], ['isItalic', 3], ['isUnderline', 4], ['isBlink', 5], ['isInverse', 7], ['isInvisible', 8], ['isStrikethrough', 9], ['isOverline', 53]]) if (cell[name]() && !(prompt && name === 'isDim')) parts.push(code);
  for (const [side, code] of [['Fg', 38], ['Bg', 48]]) {
    if (prompt && side === 'Bg') continue;
    const color = cell['get' + side + 'Color']();
    if (prompt && side === 'Fg' && (cell.isFgDefault() || cell.isFgPalette() && color === 15)) {
      if (accent) parts.push(38, 2, ...accent);
      continue;
    }
    if (cell['is' + side + 'RGB']()) parts.push(code, 2, color >> 16 & 255, color >> 8 & 255, color & 255);
    else if (cell['is' + side + 'Palette']()) parts.push(code, 5, color);
  }
  return '\x1b[' + parts.join(';') + 'm';
}

function promptRows(terminal) {
  const result = new Set(), buffer = terminal.buffer.active, cursor = buffer.baseY + buffer.cursorY;
  const end = buffer.viewportY + terminal.rows;
  const background = cell => cell ? cell.getBgColorMode() + ':' + cell.getBgColor() : null;
  // shortcut: Codex 0.167 submitted-prompt marker + shaded block; revalidate on upstream layout changes.
  for (let y = 0; y < end; y++) {
    const line = buffer.getLine(y); if (!line) continue;
    let marker;
    for (let x = 0; x < Math.min(4, terminal.cols); x++) {
      const cell = line.getCell(x);
      if (cell?.getChars() === '›' && cell.isBold() && (cell.isDim() || cell.isFgPalette() && cell.getFgColor() === 15) && !cell.isBgDefault()) { marker = x; break; }
      if (cell?.getChars().trim()) break;
    }
    if (marker === undefined) continue;
    const bg = background(line.getCell(marker)); let start = y, finish = y;
    while (start > 0 && background(buffer.getLine(start - 1)?.getCell(marker)) === bg) start--;
    while (finish + 1 < end && background(buffer.getLine(finish + 1)?.getCell(marker)) === bg) finish++;
    if (cursor < start || cursor > finish) for (let row = Math.max(start, buffer.viewportY); row <= finish; row++) result.add(row - buffer.viewportY);
    y = finish;
  }
  return result;
}

class FrameRenderer {
  constructor() { this.rows = []; }
  frame(terminal, state, snapshot, { showCursor = true, suppressed = false, theme } = {}) {
    const { cols, rows } = terminal, buffer = terminal.buffer.active;
    if (this.cols !== cols || this.height !== rows) { this.rows = []; this.tail = null; this.cols = cols; this.height = rows; }
    const rect = suppressed ? null : state.rect(cols, rows), panel = rect ? panelLines(state, snapshot) : null;
    const accent = theme?.accent, prompts = !suppressed ? promptRows(terminal) : new Set();
    let changed = '';
    for (let y = 0; y < rows; y++) {
      const source = buffer.getLine(buffer.viewportY + y), cells = [];
      for (let x = 0; x < cols; x++) {
        const cell = source?.getCell(x);
        const prompt = prompts.has(y);
        cells.push({ text: cell?.getChars() || ' ', width: cell?.getWidth() ?? 1, style: style(cell, prompt, accent) });
      }
      if (rect && y >= rect.y && y < rect.y + rect.height) {
        const line = y - rect.y, color = line === 0 || line === rect.height - 1 ? 36 : 37;
        for (let x = 0; x < rect.width; x++) cells[rect.x + x] = { text: panel[line][x], width: 1, style: '\x1b[0;' + color + ';40m' };
      }
      // Repair a wide glyph cut by the panel edge without changing the source buffer.
      for (let x = 0; x < cols; x++) {
        if (cells[x].width === 2 && cells[x + 1]?.width !== 0 || cells[x].width === 0 && cells[x - 1]?.width !== 2) cells[x] = { ...cells[x], text: ' ', width: 1 };
      }
      let line = '', previousStyle;
      for (const cell of cells) {
        if (cell.width === 0) continue;
        if (cell.style !== previousStyle) { line += cell.style; previousStyle = cell.style; }
        line += cell.text;
      }
      if (this.rows[y] !== line) { changed += '\x1b[' + (y + 1) + ';1H' + line; this.rows[y] = line; }
    }
    const cursorY = buffer.baseY - buffer.viewportY + buffer.cursorY;
    const tail = '\x1b[0m\x1b[?7h\x1b[' + (Math.max(0, Math.min(rows - 1, cursorY)) + 1) + ';' + (Math.min(cols - 1, buffer.cursorX) + 1) + 'H' +
      '\x1b[?1' + (terminal.modes.applicationCursorKeysMode ? 'h' : 'l') + '\x1b[?2004' + (terminal.modes.bracketedPasteMode ? 'h' : 'l') +
      (showCursor && cursorY >= 0 && cursorY < rows ? '\x1b[?25h' : '\x1b[?25l');
    if (!changed && this.tail === tail) return '';
    this.tail = tail;
    return '\x1b[?2026h' + (changed ? '\x1b[?25l\x1b[?6l\x1b[r\x1b[?7l' + changed : '') + tail + '\x1b[?2026l';
  }
}

module.exports = { FrameRenderer };
