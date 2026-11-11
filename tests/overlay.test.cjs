const test = require('node:test');
const assert = require('node:assert/strict');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { OverlayState, InputRouter, composeFrame, panelLines } = require('../src/overlay.cjs');
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));

test('a user-owned F9 binding is forwarded without suspending the overlay', () => {
  const state = new OverlayState(); state.commandCenterShortcut = false;
  const input = new InputRouter(state, () => ({ cols: 100, rows: 30 }));
  assert.equal(input.push('\x1b[20~'), '\x1b[20~'); assert.equal(state.suspended, false);
  const windowsF9 = '\x1b[120;0;0;1;0;1_';
  assert.equal(input.push(windowsF9), windowsF9); assert.equal(state.suspended, false);
});

test('command center receives F9 intact and releases overlay navigation without changing saved visibility', () => {
  const state = new OverlayState(); let navigated = 0;
  const input = new InputRouter(state, () => ({ cols: 100, rows: 30 }), () => navigated++);
  input.push('\x1b[24~');
  assert.equal(input.push('\x1b[20~'), '\x1b[20~');
  assert.equal(state.editing, false); assert.equal(state.suspended, true); assert.equal(state.saved().visible, true);
  assert.equal(navigated, 1);
  assert.equal(input.push('\x1b[B\t'), '\x1b[B\t');
  assert.equal(input.push('\r'), '\r'); assert.equal(state.suspended, false);
  input.push('\x1b[24~'); assert.equal(input.push('/agents'), '/agents'); assert.equal(state.editing, false);
});

test('native Windows F9 and ordinary typing release overlay focus while preserving key records', () => {
  const state = new OverlayState(), input = new InputRouter(state, () => ({ cols: 100, rows: 30 }));
  const f9 = '\x1b[120;0;0;1;0;1_';
  input.push('\x1b[24~'); assert.equal(input.push(f9), f9); assert.equal(state.editing, false); assert(state.suspended);
  input.push('\x1b[24~'); assert.equal(state.suspended, false);
  const letter = '\x1b[65;0;97;1;0;1_';
  assert.equal(input.push(letter), letter); assert.equal(state.editing, false);
});

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
  assert.equal(state.editing, false);
  input.push('\x1b[24~');
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

test('split unknown CSI and SS3 sequences remain intact while editing', () => {
  const state = new OverlayState(), input = new InputRouter(state, () => ({ cols: 100, rows: 30 }));
  input.push('\x1b[24~');
  assert.equal(input.push('\x1b[1;2'), '');
  assert.equal(input.push('H'), '\x1b[1;2H');
  assert.equal(state.visible, true);
  assert.equal(input.push('\x1bO'), '');
  assert.equal(input.push('H'), '\x1bOH');
  assert.equal(state.visible, true);
});

test('Windows terminal key records handle controls without consuming ordinary or modified keys', () => {
  const state = new OverlayState(), input = new InputRouter(state, () => ({ cols: 100, rows: 30 }));
  const key = (vk, char = 0, down = 1, modifiers = 0) => `\x1b[${vk};0;${char};${down};${modifiers};1_`;
  assert.equal(input.push(key(123).slice(0, -1)), '');
  assert.equal(input.push('_'), '');
  assert(state.editing);
  assert.equal(input.push(key(123, 0, 0)), '');
  assert(state.editing);
  assert.equal(input.push(key(37)), '');
  assert.equal(state.x, 51);
  assert.equal(input.push(key(9, 9)), '');
  assert.equal(state.scope, 'request');
  assert.equal(input.push(key(65, 97)), key(65, 97));
  assert.equal(input.push(key(123, 0, 1, 8)), key(123, 0, 1, 8));
  input.push('\x1b[24~');
  assert.equal(input.push(key(27, 27)), '');
  assert.equal(state.editing, false);
  assert.equal(input.push(key(37)), key(37));
});

test('Windows VT character records decode fragmented legacy shortcuts and preserve regular text', () => {
  const state = new OverlayState(), input = new InputRouter(state, () => ({ cols: 100, rows: 30 }));
  const encode = text => [...text].map(char => `\x1b[0;0;${char.codePointAt(0)};1;0;1_`).join('');
  const f12 = encode('\x1b[24~');
  assert.equal(input.push(f12.slice(0, 8)), '');
  assert.equal(input.push(f12.slice(8)), '');
  assert(state.editing);
  assert.equal(input.push(encode('\x1b[D\x1b[B')), '');
  assert.equal(state.x, 51); assert.equal(state.y, 1);
  assert.equal(input.push(encode('h')), '');
  assert.equal(state.visible, false);
  assert.equal(input.push(encode('literal')), 'literal');
  input.push('\x1b[1;2'); assert.equal(input.flush(), '');
  assert.equal(input.push('H'), '\x1b[1;2H');
});

for (const alternate of [false, true]) test(`compositor restores covered Codex content after moving/hiding (${alternate ? 'alternate' : 'normal'} buffer)`, async () => {
  const source = new Terminal({ cols: 100, rows: 20, allowProposedApi: true });
  const output = new Terminal({ cols: 100, rows: 20, allowProposedApi: true });
  const serialize = new SerializeAddon(); source.loadAddon(serialize);
  await write(source, (alternate ? '\x1b[?1049h' : '') + '\x1b[H' + 'original-content'.padEnd(100, 'x') + '\x1b[3;1H' + '漢字 e\u0301 🦊 '.repeat(15) + '\x1b[12;1HCodex input: ');
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
