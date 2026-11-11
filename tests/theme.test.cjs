const test = require('node:test'), assert = require('node:assert/strict');
const { TerminalTheme, chooseUserColor, contrast } = require('../src/theme.cjs');

test('paired real terminal reports choose readable user text distinct from normal text', () => {
  for (const [fg, bg] of [[[255,255,255],[12,12,12]], [[0,0,0],[255,255,255]], [[240,190,110],[40,55,80]]]) {
    const color = chooseUserColor(fg, bg);
    assert(contrast(color, bg) >= 4.5); assert.notDeepEqual(color, fg);
  }
  assert.equal(chooseUserColor(null, [0,0,0]), null);
});

test('color queries are read-only; only child-requested reports go back into Codex', () => {
  const output = [], forwarded = [], theme = new TerminalTheme({ output: d => output.push(d), forward: d => forwarded.push(d) });
  theme.query(10); theme.query(11);
  assert.deepEqual(output, ['\x1b]10;?\x1b\\', '\x1b]11;?\x1b\\']);
  assert(theme.consume('\x1b]10;rgb:ffff/ffff/ffff\x07'));
  assert.equal(theme.accent, null);
  assert(theme.consume('\x1b]11;rgb:1111/1111/1111\x1b\\'));
  assert(theme.accent); assert.equal(forwarded.length, 0);
  theme.query(10, true); assert.equal(forwarded.length, 1);
  assert.equal(theme.consume('\x1b]11;rgb:not/a/color\x07'), false);
  assert.equal(theme.consume('\x1b]52;c;PRIVATE\x07'), false);
  const disabled = new TerminalTheme({ enabled: false });
  disabled.consume('\x1b]10;rgb:ff/ff/ff\x07'); disabled.consume('\x1b]11;rgb:00/00/00\x07');
  assert.equal(disabled.accent, null);
});
