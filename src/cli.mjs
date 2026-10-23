import { main } from './bridge.mjs';
main().catch(()=>{process.stderr.write('Project MCP bridge could not start. Check the manifest syntax and installation.\n');process.exitCode=1;});
