import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
await build({entryPoints:['src/cli.mjs'],outfile:'dist/bridge.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',banner:{js:'#!/usr/bin/env node'},legalComments:'eof'});
await chmod('dist/bridge.cjs',0o755);
await build({entryPoints:['examples/design-studio/server.mjs'],outfile:'dist/design-example.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',legalComments:'eof'});
