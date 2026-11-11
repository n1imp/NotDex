const test = require('node:test'), assert = require('node:assert/strict');
const { Terminal } = require('@xterm/headless');
const { FrameRenderer } = require('../src/renderer.cjs');
const { OverlayState } = require('../src/overlay.cjs');
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));

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
