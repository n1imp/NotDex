const { panelLines } = require('./overlay.cjs');

function style(cell) {
  if (!cell || cell.isAttributeDefault()) return '\x1b[0m';
  const parts = [0];
  for (const [name, code] of [['isBold', 1], ['isDim', 2], ['isItalic', 3], ['isUnderline', 4], ['isBlink', 5], ['isInverse', 7], ['isInvisible', 8], ['isStrikethrough', 9], ['isOverline', 53]]) if (cell[name]()) parts.push(code);
  for (const [side, code] of [['Fg', 38], ['Bg', 48]]) {
    const color = cell['get' + side + 'Color']();
    if (cell['is' + side + 'RGB']()) parts.push(code, 2, color >> 16 & 255, color >> 8 & 255, color & 255);
    else if (cell['is' + side + 'Palette']()) parts.push(code, 5, color);
  }
  return '\x1b[' + parts.join(';') + 'm';
}

class FrameRenderer {
  constructor() { this.rows = []; }
  frame(terminal, state, snapshot, { showCursor = true, suppressed = false } = {}) {
    const { cols, rows } = terminal, buffer = terminal.buffer.active;
    if (this.cols !== cols || this.height !== rows) { this.rows = []; this.tail = null; this.cols = cols; this.height = rows; }
    const rect = suppressed ? null : state.rect(cols, rows), panel = rect ? panelLines(state, snapshot) : null;
    let changed = '';
    for (let y = 0; y < rows; y++) {
      const source = buffer.getLine(buffer.viewportY + y), cells = [];
      for (let x = 0; x < cols; x++) {
        const cell = source?.getCell(x);
        cells.push({ text: cell?.getChars() || ' ', width: cell?.getWidth() ?? 1, style: style(cell) });
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
