const test = require('node:test'), assert = require('node:assert/strict');
const { Terminal } = require('@xterm/headless');
const { FrameRenderer } = require('../src/renderer.cjs');
const { OverlayState } = require('../src/overlay.cjs');
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));

test('ConPTY white prompt text uses the verified accent or the terminal default foreground', async t => {
  const source = new Terminal({ cols: 80, rows: 20, allowProposedApi: true });
  const target = new Terminal({ cols: 80, rows: 20, allowProposedApi: true });
  t.after(() => { source.dispose(); target.dispose(); });
  await write(source, '\x1b[48;2;41;41;41m\x1b[1;97m› \x1b[22mUSER\x1b[33m GOLD\x1b[0m\x1b[10;1H');
  const state = new OverlayState({ visible: false }), renderer = new FrameRenderer();
  await write(target, renderer.frame(source, state, {}, { theme: { accent: [90, 0, 120] } }));
  assert.equal(target.buffer.active.getLine(0).getCell(2).getFgColor(), 0x5a0078);
  assert.equal(target.buffer.active.getLine(0).getCell(8).getFgColor(), 3);
  await write(target, renderer.frame(source, state, {}));
  assert(target.buffer.active.getLine(0).getCell(2).isFgDefault());
});

test('verified submitted prompts use contrasted foreground without changing assistant, composer or source cells', async t => {
  const { TerminalTheme } = require('../src/theme.cjs');
  const source = new Terminal({ cols: 80, rows: 20, allowProposedApi: true });
  const target = new Terminal({ cols: 80, rows: 20, allowProposedApi: true });
  t.after(() => { source.dispose(); target.dispose(); });
  await write(target, '\x1b[?1049h');
  const fill = row => `\x1b[${row};1H\x1b[48;2;41;41;41m\x1b[2K`;
  await write(source, '\x1b[?1049h' + fill(1) + fill(2) + '\x1b[1;2m› \x1b[22mUSER 漢字' + fill(3) + '  continued' + fill(4) + '\x1b[0m\x1b[6;1HASSISTANT\x1b[10;1H\x1b[48;2;10;10;10m\x1b[2K\x1b[1;2m› \x1b[22mDRAFT');
  const theme = new TerminalTheme();
  theme.consume('\x1b]10;rgb:ff/ff/ff\x07'); theme.consume('\x1b]11;rgb:00/00/00\x07');
  const state = new OverlayState({ visible: false }), renderer = new FrameRenderer();
  await write(target, renderer.frame(source, state, {}, { theme }));
  const cell = target.buffer.active.getLine(1).getCell(2);
  assert(cell.isFgRGB()); assert(cell.isBgDefault());
  assert.equal(cell.getFgColor(), theme.accent.reduce((v, n) => v * 256 + n, 0));
  assert.equal(target.buffer.active.getLine(2).getCell(2).getFgColor(), cell.getFgColor());
  assert(target.buffer.active.getLine(5).getCell(0).isFgDefault());
  assert.equal(target.buffer.active.getLine(9).getCell(2).getBgColor(), 0x0a0a0a);
  assert.equal(source.buffer.active.getLine(1).getCell(2).getBgColor(), 0x292929);
  await write(target, renderer.frame(source, state, {}, {}));
  assert(target.buffer.active.getLine(1).getCell(2).isBold());
  assert(target.buffer.active.getLine(1).getCell(2).isBgDefault());
  assert(target.buffer.active.getLine(1).getCell(2).isFgDefault());
});

test('unchanged frames emit nothing; metric changes never clear the screen or repaint the chat', async t => {
  const source = new Terminal({ cols: 100, rows: 25, allowProposedApi: true }); t.after(() => source.dispose());
  await write(source, '\x1b[HCHAT_CONTENT');
  const render = new FrameRenderer(), state = new OverlayState();
  const data = { turn: { total_tokens: 110 } };
  const initial = render.frame(source, state, data);
  assert(!initial.includes('\x1b[2J'));
  assert.equal(render.frame(source, state, data), '');
  const change = render.frame(source, state, { turn: { total_tokens: 220 } });
  assert(!change.includes('\x1b[2J')); assert(!change.includes('CHAT_CONTENT')); assert(change.includes('220'));
});

test('moving, hiding and resizing restore Unicode, colors and covered content without intermediate overlay removal', async t => {
  const source = new Terminal({ cols: 100, rows: 20, allowProposedApi: true });
  const target = new Terminal({ cols: 100, rows: 20, allowProposedApi: true });
  t.after(() => { source.dispose(); target.dispose(); });
  await write(target, '\x1b[?1049h');
  await write(source, '\x1b[?1049h\x1b[H' + '漢字 e\u0301 🦊 '.repeat(14) + '\x1b[12;1H\x1b[38;2;12;34;56mCOLORED\x1b[0m');
  const render = new FrameRenderer(), state = new OverlayState();
  await write(target, render.frame(source, state, {}));
  state.x = 1; state.y = 0;
  await write(target, render.frame(source, state, {}));
  state.visible = false;
  await write(target, render.frame(source, state, {}));
  for (let y = 0; y < source.rows; y++) assert.equal(target.buffer.active.getLine(y).translateToString(false, 0, source.cols), source.buffer.active.getLine(y).translateToString(false, 0, source.cols));
  assert.equal(target.buffer.active.getLine(11).getCell(0).getFgColor(), 0x0c2238);
  source.resize(70, 18); target.resize(70, 18);
  await write(target, render.frame(source, state, {}));
  for (let y = 0; y < source.rows; y++) assert.equal(target.buffer.active.getLine(y).translateToString(false, 0, source.cols), source.buffer.active.getLine(y).translateToString(false, 0, source.cols));
});
