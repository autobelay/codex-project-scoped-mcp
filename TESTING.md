# Tested behavior

Release **v0.1.1** was installed from the public GitHub marketplace and exercised with **Codex CLI 0.163.0**, **Node.js 24.22.0**, on **macOS**, on 2026-10-23.

## Live Codex sessions

These checks used ordinary `codex exec -C <directory>` sessions with the user's installed plugin configuration. No Autobelay wrapper, MCP server overrides, or generated project configuration was used.

| Session directory | Observed result |
| --- | --- |
| Existing private project | All 19 manifest servers connected; 339 downstream tools discovered; a project-only read-only local status tool was called successfully. |
| This repository's root (no `mcp.json`) | Bridge status reported no manifest and zero downstream servers. |
| `examples/design-studio` | One server connected; Codex called `read_design_tokens` and received the fictional Field Notes tokens. |

The private-project result is summarized only. Its manifest, credentials, company identifiers, server implementations and raw tool transcripts are not included in this repository. Discovery and one read-only call do not imply that every downstream tool was executed or that every provider operation works.

The first installed-package run exposed a nested `npx` issue: npm's inherited package selector caused a downstream npm-based server to interpret its package name as a shell command. v0.1.1 removes the outer launcher's package selector and lifecycle state from child environments. The corrected release connected all servers in the subsequent live Codex run.

## Reproduce the public demonstration

```sh
codex plugin marketplace add autobelay/codex-project-scoped-mcp
codex plugin add codex-project-scoped-mcp@autobelay-project-mcp
git clone https://github.com/autobelay/codex-project-scoped-mcp.git
cd codex-project-scoped-mcp/examples/design-studio
codex exec 'Use only the project-scoped MCP: call project_mcp_status, then the project-design read_design_tokens tool. Report the returned tokens. Do not use shell or write files.'
```

In a separate session at the repository root:

```sh
codex exec 'Call only project_mcp_status. Report whether a manifest was found and the downstream server count.'
```

The expected count is zero there. `.mcp.json` configures the plugin; `mcp.json` configures a project. They intentionally have different roles.

## Automated coverage

`npm test` passes six tests using synthetic data:

1. Nearest-manifest discovery, nested Git checkouts, and worktree `.git` files.
2. Environment interpolation, manifest validation, and distinct bounded tool names.
3. The bundled process forwards tools, pagination, cwd, environment, resources and prompts while tolerating a failed sibling server.
4. Concurrent sessions keep their project catalogues separate; no-manifest sessions are inert.
5. A local Streamable HTTP fixture receives authentication headers and returns a structured tool result with its output schema intact.
6. Nested npm launches do not inherit the bridge's package selector; user registry settings and explicit project overrides are preserved.

The tests start and close their own local processes and HTTP fixture. They do not use private repositories or external services.

Desktop-specific execution, hosted threads, other operating systems, interactive OAuth, and the unsupported MCP features listed in the README are not covered by these results.
