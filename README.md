# Local Project MCP for Codex

Install once. Open a project in Codex. Use the MCP servers declared by that project.

This local plugin reads the nearest `mcp.json` at session startup and exposes its tools through a session-local MCP bridge. There is no Codex launch wrapper, configuration synchronization, scheduled job, or system-wide watcher.

## Install

Requires Node.js 22 or newer (including `npx`), Git, and a Codex CLI with plugin marketplace support. Version 0.163.0 was used for development and integration testing; see [tested behavior](TESTING.md).

```sh
codex plugin marketplace add autobelay/codex-project-scoped-mcp
codex plugin add codex-project-scoped-mcp@autobelay-project-mcp
```

Then start a **new** Codex session in a project containing `mcp.json`:

```sh
cd /path/to/project
codex
```

Ask: “Use project_mcp_status to report which project MCP servers are connected.” The underlying tools are individually available; the model does not have to call a generic dispatcher.

**Local Project MCP** is the display name; `codex-project-scoped-mcp` remains the installation ID. The MCP connection is named `local-project-mcp`. Forwarded tools include readable MCP titles while retaining their stable routing names. Clients that display raw technical names may still show the routing suffix.

The plugin launches a version-pinned release with `npx`. Its first launch downloads the bundled executable from this public GitHub repository; subsequent launches use npm's cache. There are no package installation scripts or runtime npm dependencies. Internet access is required for the initial installation. The project's own servers may have additional runtimes and credentials to install.

After rebuilding your machine, repeat the two install commands. Nothing contains a machine-specific project path.

### Update and remove

```sh
codex plugin marketplace upgrade autobelay-project-mcp
codex plugin add codex-project-scoped-mcp@autobelay-project-mcp
```

Start a new session after updating. Each plugin release pins its executable version, so upgrading the marketplace does not silently change an already-running bridge.

```sh
codex plugin remove codex-project-scoped-mcp@autobelay-project-mcp
codex plugin marketplace remove autobelay-project-mcp
```

## Why project-scoped tools?

An MCP connection combines executable behavior with context: which checkout, which credentials, which assets, and which product conventions it should use. That context often belongs to a repository rather than a person or a hosted service.

A global server list loses this relationship. Every project gets irrelevant tools; identical server names can refer to different products; and moving a checkout can invalidate absolute paths. Copying project declarations into another configuration introduces a second representation to maintain.

The repository is already the natural home for its tooling. A manifest can travel with its implementation and evolve alongside the code it understands. Resolve that manifest when the session starts, launch its processes from the manifest directory, and the active checkout supplies the context.

This bridge makes that convention usable by Codex today. It does not require that every MCP client adopt the same configuration file, and it does not turn repository servers into publicly hosted services.

## Example: a design assistant that belongs to one application

Imagine a fictional field-notes application. Its design MCP knows the local theme tokens, the component catalogue, unpublished screen references, and the current branch's navigation conventions. A fuller implementation could offer:

- `read_design_tokens`: read the palette, spacing and typography from this checkout.
- `find_screen_references`: locate the application's approved screen captures.
- `inspect_component`: explain a component's actual variants and constraints.
- `propose_screen`: produce a mockup grounded in those local assets.

Its purpose is to understand **this application**. Making it a public MCP would not make the application-specific assets useful to strangers. A hosted version would need synchronization and access to unpublished files, and could easily see a different revision from the branch being edited. A local server can directly read the relevant checkout. It may still call a remote image provider when explicitly asked; local execution does not imply every operation is offline.

The runnable [design-studio example](examples/design-studio) is deliberately smaller: one read-only tool returns fictional tokens, without any network calls or real company material.

```sh
git clone https://github.com/autobelay/codex-project-scoped-mcp.git
cd codex-project-scoped-mcp/examples/design-studio
codex
```

Ask: “Use the project-design MCP to read this project's design tokens.” The example's server is already bundled in the repository; no build is needed.

## Manifest

At the project root, place `mcp.json`:

```json
{
  "mcpServers": {
    "project-design": {
      "type": "stdio",
      "title": "Project design assistant",
      "description": "Use this checkout's design system and screen references.",
      "command": "node",
      "args": ["tooling/design/server.mjs"],
      "env": { "DESIGN_TOKEN_FILE": "tooling/design/tokens.json" }
    },
    "project-docs": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${env:DOCS_TOKEN}" }
    }
  }
}
```

The HTTPS URL above is illustrative, not a working service. Environment references use `${env:NAME}`. Variables must be present in the bridge's environment; Codex may filter inherited variables, so configure forwarding through its MCP `env_vars` option when needed. The bridge does not read `.env` files. Do not commit credentials to the manifest.

Discovery starts at the MCP process's session working directory and walks upward to the nearest `mcp.json`. It stops at a Git checkout root (`.git` directory or worktree file). A nested checkout does not inherit its parent's manifest. A worktree must contain its own manifest and the assets its servers need; the bridge does not silently switch to the primary checkout. Outside a project, it exposes only its status tool.

Relative command arguments and environment values remain unchanged. Stdio servers run with the manifest's parent directory as `cwd`, so their own relative file access follows that project. No manifest contents are copied into global Codex config. Each session owns its connections, which close when the session ends. Changes to `mcp.json` take effect in the next session.

## Standards and supported features

- **Model Context Protocol:** uses the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) for protocol negotiation and JSON-RPC transport. Supports stdio, Streamable HTTP and legacy SSE downstream; presents stdio to Codex.
- **SEP-2633:** implements the practical `mcp.json` subset proposed in [Standard Client-Side Configuration Format](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2633): `mcpServers`, named servers, transport types, commands, arguments, environment, headers, title and description. This is an evolving proposal, not a finalized universal standard. Interactive `oauth` configuration is explicitly unsupported.
- **Codex plugins:** distributed using the documented `.codex-plugin/plugin.json`, `.mcp.json` and `.agents/plugins/marketplace.json` compatibility format. No lifecycle hooks or modifications to Codex internals.

Tools preserve input/output schemas, annotations, and structured/image/text results. Names include the original server/tool labels and a stable digest to avoid collisions. Server instructions and manifest descriptions accompany tools. Paginated tool lists and tool-list change notifications are supported. Calls forward cancellation and use a five-minute timeout.

Listed resources and prompts are forwarded with namespaced identifiers. Resource templates, subscriptions, completion, sampling, elicitation, interactive OAuth, and experimental task execution are not implemented. The bridge does not advertise these capabilities downstream. A normal tool that returns a job ID and provides polling tools works normally. Do not interpret this package as a transparent proxy for every MCP extension.

Connection attempts are concurrent and bounded to 30 seconds per initialization/list request. A failed server does not hide tools from healthy servers. `project_mcp_status` reports failure without printing raw credentials, child stderr, headers or transport errors. A disconnected server requires a new session to reconnect. Child stderr is drained and suppressed; diagnose a failing server directly in its checkout. Tool results are forwarded as returned by the server and can contain private data.

Installing the plugin enables execution of commands in discovered project manifests. Use it with repositories whose tooling you trust. The bridge does not sandbox downstream servers or override Codex's tool approval settings. An HTTP server's interactive login in Codex is not automatically shared with the bridge; use configured authenticated headers for those connections.

## Codex desktop and the public directory

This repository is a public, Git-backed **Codex plugin marketplace**. That is distinct from a listing in OpenAI's official Plugin Directory. Installation uses Codex's own marketplace commands.

The compatibility-format MCP entry intentionally omits `cwd`: local Codex supplies the session directory. The executable is resolved through `npx`, rather than relying on plugin-path placeholder expansion. The newer portable Agent Plugins format defaults MCP execution to the plugin directory; simply converting the manifest would break project discovery. We retain the documented Codex format until portable plugins have a suitable project-context mechanism.

The CLI and desktop share plugin configuration, but directory handoff must be supplied by a local Codex session. CLI integration is exercised on this repository's tested version; a desktop-specific integration result is not implied. Hosted/cloud threads are not supported.

The package contains no lifecycle hooks. OpenAI currently requires approved-partner allowlisting for public local-MCP submissions, and marks them desktop-only. Marketplace acceptance and support for a dynamically aggregated tool catalogue remain OpenAI's decisions. This project is not an official-directory listing and is not affiliated with OpenAI. See [marketplace submission notes](MARKETPLACE.md), [plugin packaging](https://developers.openai.com/plugins/build/plugins) and [desktop-only submission](https://developers.openai.com/plugins/deploy/desktop-only).

## Standalone use and development

The release tarball also provides a normal MCP executable:

```sh
npx --yes --package https://github.com/autobelay/codex-project-scoped-mcp/releases/download/v0.1.2/autobelay-codex-project-scoped-mcp-0.1.2.tgz codex-project-scoped-mcp
```

This speaks MCP over stdin/stdout; it is not an interactive command. `--directory PATH`, `--manifest PATH` and `--only server-a,server-b` are available for explicit embedding and diagnosis. Normal plugin installation needs none of them.

```sh
npm ci
npm run build
npm test
```

The tests exercise the bundled executable, discovery from subdirectories, worktree and nested-checkout behavior, concurrent project isolation, tool pagination, relative cwd, environment propagation, failed sibling servers, authenticated HTTP, structured results, nested npx execution, resources and prompts. Fixtures contain only synthetic data. Built artifacts are committed so Git marketplace installations do not need dependency installation or a build hook.

MIT licensed. Bundled dependency notices are in `THIRD_PARTY_NOTICES`.
