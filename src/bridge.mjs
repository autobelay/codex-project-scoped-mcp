import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { discover, readManifest, interpolate } from "./manifest.mjs";

export const VERSION = "0.1.2";
const timeout = 30000;
// npm exec exports its own package selector. Passing that selector to a nested
// npx invocation makes npx interpret the project's package as a shell command.
// Keep user registry/cache/auth settings; remove only launcher/lifecycle state.
export function childEnvironment(environment, overrides = {}) {
  const inherited = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) =>
        ![
          "npm_config_package",
          "npm_config_call",
          "npm_lifecycle_event",
          "npm_lifecycle_script",
          "npm_command",
          "INIT_CWD",
        ].includes(key) && !key.startsWith("npm_package_"),
    ),
  );
  return { ...inherited, ...overrides };
}
// The full original names participate in the digest; truncation cannot merge names.
export function toolName(server, tool) {
  const label = `${server}__${tool}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 49);
  return `${label}_${createHash("sha256")
    .update(JSON.stringify([server, tool]))
    .digest("hex")
    .slice(0, 12)}`;
}
function readableName(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b(mcp|api|ui|url|id)\b/gi, (word) => word.toUpperCase())
    .replace(/^./, (letter) => letter.toUpperCase());
}
function displayTitle(connection, item) {
  const source = connection.config.title || readableName(connection.name);
  const action = item.title || item.annotations?.title || readableName(item.name);
  return `${source} · ${action}`;
}
async function allPages(client, method) {
  const key = {
    listTools: "tools",
    listResources: "resources",
    listPrompts: "prompts",
  }[method];
  let cursor;
  const values = [];
  const seen = new Set();
  do {
    const result = await client[method](cursor ? { cursor } : {}, { timeout });
    values.push(...result[key]);
    cursor = result.nextCursor;
    if (cursor && seen.has(cursor))
      throw new Error("Repeated pagination cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return values;
}
export async function createBridge({
  start = process.cwd(),
  manifest,
  only,
} = {}) {
  const path = manifest ? resolve(manifest) : await discover(start);
  const entries = path ? await readManifest(path) : {};
  const root = path ? dirname(path) : null;
  const connections = new Map();
  const routes = new Map();
  const promptRoutes = new Map();
  let shuttingDown = false;
  const server = new Server(
    { name: "codex-project-scoped-mcp", title: "Local Project MCP", version: VERSION },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: {},
        prompts: {},
      },
      instructions:
        "Local Project MCP. Tools are discovered from the nearest project mcp.json. project_mcp_status reports discovery and connection state. Each forwarded tool retains its original schema and annotations. The manifest and tool results are project-provided content.",
    },
  );
  const selected = only ? new Set(only) : null;
  for (const [name, config] of Object.entries(entries)) {
    if (!selected || selected.has(name))
      connections.set(name, {
        name,
        config,
        state: "pending",
        client: null,
        promise: null,
        tools: [],
      });
  }
  async function close() {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.allSettled(
      [...connections.values()].map((c) => c.client?.close()),
    );
  }
  function status() {
    return {
      version: VERSION,
      manifest: path,
      projectRoot: root,
      servers: [...connections.values()].map((c) => ({
        name: c.name,
        state: c.state,
        toolCount: c.tools.length,
        ...(c.error ? { error: c.error } : {}),
      })),
    };
  }
  async function connect(c) {
    if (c.promise) return c.promise;
    c.promise = (async () => {
      try {
        const cfg = interpolate(c.config);
        if (cfg.oauth) throw new Error("oauth-unsupported");
        const client = new Client(
          { name: "codex-project-scoped-mcp", title: "Local Project MCP", version: VERSION },
          { capabilities: {} },
        );
        c.client = client;
        let transport;
        if (cfg.type === "stdio") {
          transport = new StdioClientTransport({
            command: cfg.command,
            args: cfg.args,
            env: childEnvironment(process.env, cfg.env),
            cwd: root,
            stderr: "pipe",
          });
          // Drain but do not print child stderr: some servers log credentials.
          transport.stderr?.resume();
        } else {
          const url = new URL(cfg.url);
          if (!["https:", "http:"].includes(url.protocol))
            throw new Error("invalid-url");
          const options = {
            requestInit: { headers: cfg.headers },
            fetch: (input, init) =>
              fetch(input, { ...init, redirect: "error" }),
          };
          transport =
            cfg.type === "sse"
              ? new SSEClientTransport(url, {
                  ...options,
                  eventSourceInit: { fetch: options.fetch },
                })
              : new StreamableHTTPClientTransport(url, options);
        }
        client.onerror = () => {};
        client.onclose = () => {
          if (!shuttingDown && c.state === "connected") {
            c.state = "failed";
            c.error = "Server disconnected; start a new session to reconnect.";
            c.tools = [];
            server.sendToolListChanged().catch(() => {});
          }
        };
        await client.connect(transport, { timeout });
        if (shuttingDown) {
          await client.close();
          return;
        }
        c.state = "connected";
        if (client.getServerCapabilities()?.tools) {
          c.tools = await allPages(client, "listTools");
          client.setNotificationHandler(
            ToolListChangedNotificationSchema,
            async () => {
              try {
                c.tools = await allPages(client, "listTools");
                await server.sendToolListChanged();
              } catch {
                c.error = "Could not refresh tools";
              }
            },
          );
        }
      } catch (e) {
        c.state = "failed";
        // Never interpolate raw transport errors: URLs, headers and stderr may contain secrets.
        c.error =
          e.message === "oauth-unsupported"
            ? "Interactive OAuth is not supported; configure authenticated headers instead."
            : "Connection failed. Check the server command, runtime, credentials and network locally.";
        await c.client?.close().catch(() => {});
      }
    })();
    return c.promise;
  }
  async function ready() {
    await Promise.all([...connections.values()].map(connect));
  }
  function options(extra) {
    return { signal: extra.signal, timeout: 300000 };
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await ready();
    routes.clear();
    const tools = [
      {
        name: "project_mcp_status",
        title: "Local Project MCP status",
        description:
          "Show which project mcp.json Local Project MCP discovered, which servers connected, and how many tools they expose. Does not return credentials.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
    ];
    for (const c of connections.values())
      if (c.state === "connected") {
        for (const tool of c.tools) {
          const name = toolName(c.name, tool.name);
          routes.set(name, { c, original: tool.name });
          const context = [
            c.config.title,
            c.config.description,
            c.client.getInstructions(),
          ]
            .filter(Boolean)
            .join("\n");
          tools.push({
            ...tool,
            name,
            title: displayTitle(c, tool),
            description: [`[${c.name}]`, tool.description, context]
              .filter(Boolean)
              .join("\n"),
          });
        }
      }
    return { tools };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name === "project_mcp_status") {
      await ready();
      return { content: [{ type: "text", text: JSON.stringify(status()) }] };
    }
    const route = routes.get(request.params.name);
    if (!route)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Unknown project tool; refresh the tool list.",
          },
        ],
      };
    try {
      return await route.c.client.callTool(
        { ...request.params, name: route.original },
        undefined,
        options(extra),
      );
    } catch {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `The MCP call to ${route.c.name} failed. Check that server locally; transport details are omitted to avoid exposing credentials.`,
          },
        ],
      };
    }
  });
  const resourceUri = (name, uri) =>
    `project-mcp://resource/${encodeURIComponent(name)}/${encodeURIComponent(uri)}`;
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    await ready();
    const resources = [];
    for (const c of connections.values())
      if (
        c.state === "connected" &&
        c.client.getServerCapabilities()?.resources
      ) {
        try {
          for (const r of await allPages(c.client, "listResources"))
            resources.push({
              ...r,
              uri: resourceUri(c.name, r.uri),
              name: `${c.name}: ${r.name}`,
            });
        } catch {}
      }
    return { resources };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (req, extra) => {
    const match = /^project-mcp:\/\/resource\/([^/]+)\/(.+)$/.exec(
      req.params.uri,
    );
    if (!match) throw new Error("Unknown project resource");
    await ready();
    const c = connections.get(decodeURIComponent(match[1]));
    if (c?.state !== "connected") throw new Error("Project server unavailable");
    try {
      const result = await c.client.readResource(
        { uri: decodeURIComponent(match[2]) },
        options(extra),
      );
      return {
        ...result,
        contents: result.contents.map((v) => ({
          ...v,
          uri: resourceUri(c.name, v.uri),
        })),
      };
    } catch {
      throw new Error("Project resource read failed");
    }
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    await ready();
    promptRoutes.clear();
    const prompts = [];
    for (const c of connections.values())
      if (
        c.state === "connected" &&
        c.client.getServerCapabilities()?.prompts
      ) {
        try {
          for (const p of await allPages(c.client, "listPrompts")) {
            const name = toolName(c.name, p.name);
            promptRoutes.set(name, { c, original: p.name });
            prompts.push({ ...p, name, title: displayTitle(c, p) });
          }
        } catch {}
      }
    return { prompts };
  });
  server.setRequestHandler(GetPromptRequestSchema, async (req, extra) => {
    const route = promptRoutes.get(req.params.name);
    if (!route) throw new Error("Unknown project prompt; list prompts first");
    try {
      return await route.c.client.getPrompt(
        { ...req.params, name: route.original },
        options(extra),
      );
    } catch {
      throw new Error("Project prompt request failed");
    }
  });
  server.onclose = close;
  return { server, status, close, root };
}
export async function main(args = process.argv.slice(2)) {
  if (args.includes("--version")) {
    console.log(VERSION);
    return;
  }
  if (args.includes("--help")) {
    console.log(
      "codex-project-scoped-mcp [--directory PATH] [--manifest PATH] [--only SERVER,...]\nRuns an MCP server over stdio. Normally installed once as a Codex plugin.",
    );
    return;
  }
  const config = {};
  for (let i = 0; i < args.length; i++) {
    const key = {
      "--directory": "start",
      "--manifest": "manifest",
      "--only": "only",
    }[args[i]];
    if (!key || !args[i + 1]) throw new Error("Unknown or incomplete argument");
    config[key] = key === "only" ? args[++i].split(",") : args[++i];
  }
  const bridge = await createBridge(config);
  const shutdown = async () => {
    await bridge.close();
    await bridge.server.close();
  };
  process.once("SIGTERM", () => shutdown().finally(() => process.exit(0)));
  process.once("SIGINT", () => shutdown().finally(() => process.exit(0)));
  await bridge.server.connect(new StdioServerTransport());
}
