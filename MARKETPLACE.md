# Distribution and OpenAI directory submission

The public GitHub repository is a Codex marketplace today:

```sh
codex plugin marketplace add autobelay/codex-project-scoped-mcp
codex plugin add codex-project-scoped-mcp@autobelay-project-mcp
```

The plugin uses Codex's documented compatibility manifest format. It has a local stdio MCP entry, contains its bundled JavaScript implementation and dependency notices, and has no hooks, daemon, hosted endpoint or installation scripts. Node.js 22+ and npx are required. The launch command uses a version-pinned release tarball; the plugin directory itself is not used as the project working directory.

## Official directory status

This package has not been submitted to, approved by, or listed in the official OpenAI Plugin Directory. Its GitHub marketplace is independently published by Autobelay.

OpenAI's current documentation limits local MCP submissions to approved partners whose submitting organization has been allowlisted. A listed local plugin is desktop-only. See [Submit desktop-only plugins](https://developers.openai.com/plugins/deploy/desktop-only).

Questions to discuss with OpenAI:

- Can this organization submit a local MCP plugin that discovers tools from the active project's manifest?
- Is a dynamic, repository-dependent tool catalogue supported by directory review and runtime discovery?
- Can an official installation use the compatibility-format launch semantics to inherit the local session working directory?
- What supported mechanism will portable Agent Plugins have for receiving the active project directory, independently of the plugin directory?
- Is fetching the pinned public executable with npx acceptable, or is a plugin-relative executable plus explicit session context preferred?

The package deliberately does not pretend that plugin-directory cwd is project cwd. If OpenAI requires portable packaging, the missing session-context mechanism must be addressed rather than converting the manifest and losing discovery.

The release's plugin ZIP can be used as the technical package for discussion. Submission will also need the publisher's verified identity, organization access, listing artwork/screenshots, any portal-specific metadata, and OpenAI's review. These are not supplied by installing this repository.

## Reviewer demonstration without private data

Clone this public repository, install its plugin, and open `examples/design-studio` in a new local Codex session. Ask Codex to call the `project-design` server's `read_design_tokens` tool. It reads only the fictional `tokens.json` in that directory. In a separate local session at the repository root, `project_mcp_status` reports no project manifest and no downstream servers. No accounts, credentials, cloud services or company data are needed for this demonstration.

## Rebuilding releases

`npm ci`, `npm run build`, and `npm pack` produce the bundled npm artifact. The runtime has no npm dependencies. `git archive --format=zip HEAD` produces a plugin ZIP with manifests, code and documentation at the ZIP root. Release tarball URLs in `.mcp.json` are pinned to the matching release version. The committed JavaScript bundles are generated from `src/` and the synthetic example.
