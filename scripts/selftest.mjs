/**
 * Static checks for the files that ship in the bundle.
 * Run from the repo root: node scripts/selftest.mjs
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const pkg = JSON.parse(read('../plugin/package.json'));
assert(pkg.name === 'dsh-surfer', 'package name');
assert(pkg.dsh.bundle.patch === './cordis.patch.yml', 'bundle patch');
assert(pkg.dsh.client.platform === 'web', 'client platform');
assert(pkg.exports['./client'] === './client.js', 'client export');
assert(pkg.exports['./icon'] === './icon.svg', 'icon export');
assert(pkg.files.includes('client.js') && pkg.files.includes('icon.svg'), 'files list');

const patch = read('../plugin/cordis.patch.yml');
assert(patch.includes('id: surfer') && patch.includes('name: dsh-surfer'), 'patch row');

for (const locale of ['en', 'zh']) {
	const dict = JSON.parse(read(`../plugin/locale/${locale}.json`));
	assert(dict.meta.title && dict.meta.description, `${locale} meta`);
}

const icon = read('../plugin/icon.svg');
assert(icon.startsWith('<svg') && icon.includes('</svg>'), 'icon svg');
assert(Buffer.byteLength(icon) < 256 * 1024, 'icon size');

const client = read('../plugin/client.js').replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
assert(client.startsWith('window.__ModuleLoader__.load('), 'module loader');
assert(client.includes("id: 'dsh-surfer',") && client.includes("const ID = 'dsh-surfer/wave'"), 'factory and tab ids');
assert(client.includes('export function apply') === false, 'host export stays out of client');
assert(client.includes("priority: 'extension'"), 'extension priority');
assert(client.includes("'*.vcd'") && client.includes("'*.fst'") && client.includes("'*.ghw'"), 'patterns');
assert(client.includes('workspaceFiles.readBytes'), 'byte read');
assert(client.includes('range: { offset, length }'), 'ranged read');
assert(client.includes('const CHUNK_BYTES = 2 * 1024 * 1024'), 'chunk size');
assert(client.includes('const MAX_BYTES = 512 * 1024 * 1024'), 'memory cap');
assert(client.includes("command: 'LoadUrl'"), 'surfer load');
assert(client.includes('surfer-ready'), 'ready handshake');
assert(client.includes("scope === 'session'"), 'session-only open');
assert(client.includes('tab.contentId'), 'tab address is contentId');
assert(client.includes('function tabAddress'), 'address reader');

const host = read('../plugin/index.js');
assert(/export function apply\(/.test(host), 'host apply');

const syntax = spawnSync(process.execPath, ['--check', new URL('../plugin/client.js', import.meta.url).pathname], { encoding: 'utf8' });
assert(syntax.status === 0, `client syntax: ${syntax.stderr}`);
const hostSyntax = spawnSync(process.execPath, ['--check', new URL('../plugin/index.js', import.meta.url).pathname], { encoding: 'utf8' });
assert(hostSyntax.status === 0, `host syntax: ${hostSyntax.stderr}`);

const address = 'dsh-resource://file/session/s1/waves/top.vcd';
assert(/\.(vcd|fst|ghw)$/i.test(address.split('/').pop()), 'suffix sniff');

console.log('dsh-surfer selftest ok');
