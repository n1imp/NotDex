const test = require('node:test');
const assert = require('node:assert/strict');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { OverlayState, InputRouter, composeFrame, panelLines } = require('../src/overlay.cjs');
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));

test('overlay starts top-right, moves anywhere inside terminal bounds, switches scope and survives resize', () => {
  const state = new OverlayState();
  assert.deepEqual(state.rect(100, 30), { x: 52, y: 0, width: 48, height: 8 });
  const input = new InputRouter(state, () => ({ cols: 100, rows: 30 }));
  assert.equal(input.push('normal'), 'normal');
  assert.equal(input.push('\x1b[24~'), '');
  assert(state.editing);
  assert.equal(input.push('\x1b[D\x1b[B\t'), '');
  assert.equal(state.x, 51); assert.equal(state.y, 1); assert.equal(state.scope, 'request');
  state.x = 999; state.y = 999;
  assert.deepEqual(state.rect(60, 15), { x: 12, y: 7, width: 48, height: 8 });
  assert.equal(state.rect(20, 5), null);
  input.push('h'); assert.equal(state.visible, false);
  input.push('\x1b[24~'); assert.equal(state.visible, true);
});

test('split key sequences and bracketed pasted text do not leak shortcuts or corrupt the Codex input', () => {
  const state = new OverlayState(), input = new InputRouter(state, () => ({ cols: 100, rows: 30 }));
  assert.equal(input.push('\x1b['), '');
  assert.equal(input.push('24~'), '');
  assert.equal(state.editing, true);
  const pasted = '\x1b[200~literal \x1b[24~ tab\t\x1b[201~';
  assert.equal(input.push(pasted), pasted);
  assert.equal(state.editing, true);
  input.push('\x1b'); assert.equal(input.flush(), ''); assert.equal(state.editing, false);
  assert.equal(input.push('\t'), '\t');
});

test('panel displays actual quota scope and reference dollars; untrusted strings cannot inject terminal escapes', () => {
  const state = new OverlayState();
  const snapshot = { session_id: 's', plan: 'plus', turn: { total_tokens: 0, input_tokens: 0, output_tokens: 0, cache_hit_pct: null,
    usd_reference: '0.000000', model: 'evil\x1b[2J\nname' }, quota: { primary: { used_percent: 23, window_minutes: 300 }, secondary: { used_percent: 37, window_minutes: 10080 } } };
  const lines = panelLines(state, snapshot);
  assert.equal(lines.length, 8);
  assert(lines.some(line => line.includes('US$ ref.std')));
  assert(lines.some(line => line.includes('Conta') && line.includes('23%') && line.includes('37%')));
  assert(!lines.join('').includes('\x1b'));
  assert(!lines.join('').includes('\n'));
  assert(lines.every(line => line.length === 48));
});

for (const alternate of [false, true]) test(`compositor restores covered Codex content after moving/hiding (${alternate ? 'alternate' : 'normal'} buffer)`, async () => {
  const source = new Terminal({ cols: 100, rows: 20, allowProposedApi: true });
  const output = new Terminal({ cols: 100, rows: 20, allowProposedApi: true });
  const serialize = new SerializeAddon(); source.loadAddon(serialize);
  await write(source, (alternate ? '\x1b[?1049h' : '') + '\x1b[H' + 'original-content'.padEnd(100, 'x') + '\x1b[12;1HCodex input: ');
  const state = new OverlayState();
  await write(output, composeFrame(source, serialize, state, {}));
  assert(output.buffer.active.getLine(0).translateToString().includes('NotDex'));
  state.x = 0; state.y = 5;
  await write(output, composeFrame(source, serialize, state, {}));
  assert.equal(output.buffer.active.getLine(0).translateToString(), source.buffer.active.getLine(0).translateToString());
  state.visible = false;
  await write(output, composeFrame(source, serialize, state, {}));
  for (let row = 0; row < 20; row++) assert.equal(output.buffer.active.getLine(row).translateToString(), source.buffer.active.getLine(row).translateToString());
  assert.equal(output.buffer.active.cursorX, source.buffer.active.cursorX);
  assert.equal(output.buffer.active.cursorY, source.buffer.active.cursorY);
  source.dispose(); output.dispose();
});
