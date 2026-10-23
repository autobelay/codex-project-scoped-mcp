import { stat, readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';

// Nearest manifest wins. Do not accidentally borrow configuration from outside
// the current Git checkout, including worktrees whose .git is a file.
export async function discover(start = process.cwd()) {
  let dir = resolve(start);
  while (true) {
    try { if ((await stat(join(dir, 'mcp.json'))).isFile()) return join(dir, 'mcp.json'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    try { await stat(join(dir, '.git')); return null; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function record(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function strings(v) { return record(v) && Object.values(v).every(x => typeof x === 'string'); }
export function validate(document) {
  if (!record(document) || !record(document.mcpServers)) throw new Error('Expected an mcpServers object');
  for (const [name, s] of Object.entries(document.mcpServers)) {
    if (!/^[a-zA-Z0-9_\[\]-]+$/.test(name)) throw new Error('Invalid server name');
    if (!record(s)) throw new Error(`Invalid server entry: ${name}`);
    if (!['stdio', 'streamable-http', 'sse'].includes(s.type)) throw new Error(`Unsupported transport for ${name}`);
    for (const field of ['title', 'description']) if (s[field] !== undefined && typeof s[field] !== 'string') throw new Error(`Invalid ${field} for ${name}`);
    if (s.type === 'stdio') {
      if (typeof s.command !== 'string' || !s.command) throw new Error(`Missing command for ${name}`);
      if (s.args !== undefined && (!Array.isArray(s.args) || !s.args.every(v => typeof v === 'string'))) throw new Error(`Invalid args for ${name}`);
      if (s.env !== undefined && !strings(s.env)) throw new Error(`Invalid env for ${name}`);
    } else {
      if (typeof s.url !== 'string') throw new Error(`Missing URL for ${name}`);
      if (s.headers !== undefined && !strings(s.headers)) throw new Error(`Invalid headers for ${name}`);
    }
  }
  return document.mcpServers;
}
export async function readManifest(path) { return validate(JSON.parse(await readFile(path, 'utf8'))); }
export function interpolate(value, env = process.env) {
  if (typeof value === 'string') return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => {
    if (env[key] === undefined) throw new Error(`Missing environment variable: ${key}`);
    return env[key];
  });
  if (Array.isArray(value)) return value.map(v => interpolate(v, env));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,interpolate(v,env)]));
  return value;
}
