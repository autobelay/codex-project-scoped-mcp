import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { discover, interpolate, validate } from "../src/manifest.mjs";
import { toolName, childEnvironment } from "../src/bridge.mjs";
const bundle = resolve("dist/bridge.cjs"),
  fixture = resolve("test/fixture.mjs");
async function temp(t) {
  const p = await mkdtemp(join(tmpdir(), "project-mcp-test-"));
  t.after(() => rm(p, { recursive: true, force: true }));
  return await realpath(p);
}
async function client(t, cwd) {
  const c = new Client({ name: "test", version: "1" }, { capabilities: {} });
  const tr = new StdioClientTransport({
    command: process.execPath,
    args: [bundle],
    cwd,
    stderr: "pipe",
  });
  tr.stderr.resume();
  await c.connect(tr);
  t.after(() => c.close());
  return c;
}
test("nearest manifest, nested checkout and worktree discovery", async (t) => {
  const p = await temp(t);
  await writeFile(join(p, "mcp.json"), "{}");
  await mkdir(join(p, "child", "nested"), { recursive: true });
  assert.equal(await discover(join(p, "child", "nested")), join(p, "mcp.json"));
  await writeFile(join(p, "child", ".git"), "gitdir: elsewhere");
  assert.equal(await discover(join(p, "child", "nested")), null);
  await writeFile(join(p, "child", "mcp.json"), "{}");
  assert.equal(
    await discover(join(p, "child", "nested")),
    join(p, "child", "mcp.json"),
  );
});
test("environment references, validation and collision-resistant names", () => {
  assert.equal(
    interpolate("prefix-${env:TOKEN}", { TOKEN: "value" }),
    "prefix-value",
  );
  assert.throws(() => interpolate("${env:MISSING}", {}), /Missing/);
  assert.throws(
    () => validate({ mcpServers: { broken: { type: "stdio" } } }),
    /command/,
  );
  assert.notEqual(toolName("a-b", "x"), toolName("a_b", "x"));
  assert.ok(toolName("s".repeat(100), "t".repeat(100)).length <= 64);
});
test("bundle discovers cwd; forwards tools, pagination, env, resources and prompts; tolerates failed sibling", async (t) => {
  const p = await temp(t);
  await mkdir(join(p, "nested"));
  await writeFile(
    join(p, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        design: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
          env: { FIXTURE_VALUE: "fictional" },
        },
        broken: {
          type: "stdio",
          command: "nonexistent-project-mcp-test-command",
        },
      },
    }),
  );
  const c = await client(t, join(p, "nested"));
  const list = await c.listTools();
  assert.equal(c.getServerVersion().title, "Local Project MCP");
  assert.equal(list.tools.find((x) => x.name === "project_mcp_status").title, "Local Project MCP status");
  assert.equal(list.tools.length, 3);
  const inspect = list.tools.find((x) => x.name.startsWith("design__inspect"));
  assert.equal(inspect.title, "Design · Inspect");
  assert.equal(list.tools.find((x) => x.name.startsWith("design__second")).title, "Design · Read another token");
  assert.equal(inspect.annotations.readOnlyHint, true);
  const result = await c.callTool({ name: inspect.name, arguments: {} });
  assert.deepEqual(JSON.parse(result.content[0].text), {
    cwd: p,
    value: "fictional",
  });
  const status = JSON.parse(
    (await c.callTool({ name: "project_mcp_status", arguments: {} })).content[0]
      .text,
  );
  assert.equal(status.servers.find((s) => s.name === "broken").state, "failed");
  const resources = await c.listResources();
  assert.equal(resources.resources.length, 1);
  assert.equal(
    (await c.readResource({ uri: resources.resources[0].uri })).contents[0]
      .text,
    "blue",
  );
  const prompts = await c.listPrompts();
  assert.equal(prompts.prompts[0].title, "Design · Design");
  assert.equal(
    (await c.getPrompt({ name: prompts.prompts[0].name })).messages[0].content
      .text,
    "Use the local palette",
  );
});
test("two concurrent sessions do not share project state and no manifest is inert", async (t) => {
  const a = await temp(t),
    b = await temp(t);
  await writeFile(
    join(a, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        only_a: { type: "stdio", command: process.execPath, args: [fixture] },
      },
    }),
  );
  const ca = await client(t, a),
    cb = await client(t, b);
  const [la, lb] = await Promise.all([ca.listTools(), cb.listTools()]);
  assert.equal(la.tools.length, 3);
  assert.deepEqual(
    lb.tools.map((x) => x.name),
    ["project_mcp_status"],
  );
});

test("Streamable HTTP forwards authentication and structured results", async (t) => {
  const { createServer } = await import("node:http");
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );
  let requests = 0;
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer synthetic-test-token") {
      res.writeHead(401).end();
      return;
    }
    requests++;
    const s = new Server(
      { name: "http-fixture", version: "1" },
      { capabilities: { tools: {} } },
    );
    s.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "read",
          inputSchema: { type: "object", properties: {} },
          outputSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
          annotations: { readOnlyHint: true },
        },
      ],
    }));
    s.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { ok: true },
    }));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      s.close();
    });
    await s.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  t.after(() => {
    http.closeAllConnections();
    return new Promise((r) => http.close(r));
  });
  const p = await temp(t);
  await writeFile(
    join(p, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        remote: {
          type: "streamable-http",
          url: `http://127.0.0.1:${http.address().port}/mcp`,
          headers: { Authorization: "Bearer synthetic-test-token" },
        },
      },
    }),
  );
  const c = await client(t, p);
  const list = await c.listTools();
  const tool = list.tools.find((x) => x.name.startsWith("remote__read"));
  assert.ok(tool);
  assert.equal(tool.outputSchema.type, "object");
  assert.deepEqual(
    (await c.callTool({ name: tool.name, arguments: {} })).structuredContent,
    { ok: true },
  );
  assert.ok(requests >= 3);
});

test("nested npx receives project settings, not the bridge package selector", () => {
  const env = childEnvironment(
    {
      PATH: "/example/bin",
      npm_config_package: "bridge-tarball",
      npm_config_registry: "https://registry.example",
      npm_package_name: "bridge",
      INIT_CWD: "/launcher",
    },
    { PROJECT_VALUE: "value" },
  );
  assert.equal(env.npm_config_package, undefined);
  assert.equal(env.npm_package_name, undefined);
  assert.equal(env.INIT_CWD, undefined);
  assert.equal(env.npm_config_registry, "https://registry.example");
  assert.equal(env.PATH, "/example/bin");
  assert.equal(env.PROJECT_VALUE, "value");
  assert.equal(
    childEnvironment(
      { npm_config_package: "bridge" },
      { npm_config_package: "explicit-project-value" },
    ).npm_config_package,
    "explicit-project-value",
  );
});
