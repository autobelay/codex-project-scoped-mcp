import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
const server = new Server(
  { name: "fictional-project-design", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "This fictional application uses its checkout-local design tokens. Read these before proposing changes.",
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_design_tokens",
      description:
        "Read this checkout’s design tokens. Read-only; no network requests.",
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
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "read_design_tokens") throw new Error("Unknown tool");
  return {
    content: [{ type: "text", text: await readFile("tokens.json", "utf8") }],
  };
});
server.connect(new StdioServerTransport()).catch(() => {
  process.exitCode = 1;
});
