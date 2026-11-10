const toml = require('smol-toml');
const { isDeepStrictEqual } = require('node:util');

function parse(text) {
  try { return toml.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('Invalid TOML in config.toml; profile unchanged.'); }
}

function withoutServer(value) {
  if (value.mcp_servers) {
    delete value.mcp_servers.notdex;
    if (!Object.keys(value.mcp_servers).length) delete value.mcp_servers;
  }
  return value;
}

function prepareMcpConfig(text, { directory, nodePath, ownedBlocks = [], remove = false }) {
  const original = parse(text);
  let clean = text, removed = false;
  for (const block of [...new Set(ownedBlocks)]) {
    if (!block || !clean.includes(block)) continue;
    if (clean.indexOf(block) !== clean.lastIndexOf(block)) throw Error('Duplicate NotDex MCP block; review config.toml.');
    const candidate = clean.replace(block, '');
    if (!isDeepStrictEqual(withoutServer(parse(clean)), withoutServer(parse(candidate)))) throw Error('NotDex MCP ownership does not match config.toml.');
    clean = candidate; removed = true;
  }
  if (original.mcp_servers?.notdex && !removed) throw Error('NotDex MCP configuration was edited or is user-owned; profile unchanged.');
  if (parse(clean).mcp_servers?.notdex) throw Error('Conflicting NotDex MCP entry; profile unchanged.');
  if (remove) return { text: clean, block: '' };
  const quote = JSON.stringify;
  const block = '\n\n# BEGIN NotDex managed MCP\n[mcp_servers.notdex]\ncommand = ' + quote(nodePath) +
    '\nargs = ' + quote(['--no-warnings', require('node:path').join(directory, 'notdex-mcp.cjs')]) +
    '\nenv_vars = ["NOTDEX_OVERLAY_ENDPOINT", "NOTDEX_OVERLAY_TOKEN"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 5\n# END NotDex managed MCP\n';
  const result = clean + block;
  if (!isDeepStrictEqual(withoutServer(parse(result)), withoutServer(original))) throw Error('Unexpected configuration change; profile unchanged.');
  return { text: result, block };
}

module.exports = { prepareMcpConfig, parse };
