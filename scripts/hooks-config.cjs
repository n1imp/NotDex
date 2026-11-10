const toml = require('smol-toml');
const { isDeepStrictEqual } = require('node:util');
const { createHash } = require('node:crypto');
const { parse } = require('./mcp-config.cjs');

function withoutOwned(hooks = {}, owns) {
  const result = structuredClone(hooks);
  for (const [event, groups] of Object.entries(result)) {
    if (event === 'state') continue;
    if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group?.hooks))) throw Error('Invalid inline hook group; profile unchanged.');
    result[event] = groups.map(group => ({ ...group, hooks: group.hooks.filter(handler => !owns(handler)) })).filter(group => group.hooks.length);
    if (!result[event].length) delete result[event];
  }
  return result;
}

function prepareHooks(text, json, { owns, ownedBlocks = [], handlers, remove = false }) {
  let clean = text;
  const original = parse(text);
  for (const block of [...new Set(ownedBlocks)]) {
    if (!clean.includes(block)) continue;
    if (clean.indexOf(block) !== clean.lastIndexOf(block)) throw Error('Duplicate managed NotDex hooks.');
    const candidate = clean.replace(block, '');
    const before = parse(clean), after = parse(candidate);
    before.hooks = withoutOwned(before.hooks, owns); after.hooks = withoutOwned(after.hooks, owns);
    if (!isDeepStrictEqual(before, after)) throw Error('NotDex hook ownership mismatch; profile unchanged.');
    clean = candidate;
  }
  if (clean.includes('# BEGIN NotDex managed hooks')) throw Error('NotDex managed hook block was edited; profile unchanged.');
  const remaining = parse(clean);
  const stripped = withoutOwned(remaining.hooks, owns);
  if (!isDeepStrictEqual(stripped, withoutOwned(remaining.hooks, () => false))) throw Error('Edited or unowned NotDex inline hook; profile unchanged.');
  if (remove) return { text: clean, block: '', inline: ownedBlocks.length > 0 };
  if (!original.hooks && !ownedBlocks.length) return { text, block: '', inline: false };
  const expected = parse(clean);
  const foreign = withoutOwned(json?.hooks, owns);
  let migratedAdded = false;
  if (foreign.state) throw Error('hooks.json state cannot be migrated automatically.');
  if (Object.keys(foreign).length) {
    const serialized = toml.stringify({ hooks: foreign });
    const hash = createHash('sha256').update(serialized).digest('hex');
    const migrated = '\n\n# BEGIN NotDex migrated JSON hooks ' + hash + '\n' + serialized + '# END NotDex migrated JSON hooks\n';
    if (!clean.includes(migrated)) { clean += migrated; migratedAdded = true; }
  }
  const block = '\n\n# BEGIN NotDex managed hooks\n' + toml.stringify({ hooks: handlers }) + '# END NotDex managed hooks\n';
  const result = clean + block;
  const final = parse(result);
  expected.hooks ||= {};
  const normalizedForeign = Object.keys(foreign).length ? parse(toml.stringify({ hooks: foreign })).hooks : {};
  for (const [event, groups] of Object.entries(normalizedForeign)) {
    if (!migratedAdded) continue;
    expected.hooks[event] = [...(expected.hooks[event] || []), ...groups];
  }
  for (const [event, groups] of Object.entries(parse(toml.stringify({ hooks: handlers })).hooks)) expected.hooks[event] = [...(expected.hooks[event] || []), ...groups];
  if (!isDeepStrictEqual(final, expected)) throw Error('Cannot safely consolidate this hook format; profile unchanged.');
  return { text: result, block, inline: true };
}

module.exports = { prepareHooks };
