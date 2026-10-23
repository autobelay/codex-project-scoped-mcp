import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
const s = new Server(
  { name: "fixture", version: "1.0.0" },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: "Synthetic design system.",
  },
);
s.setRequestHandler(ListToolsRequestSchema, async (req) => ({
  tools: [
    {
      name: req.params?.cursor ? "second" : "inspect",
      description: "Read a synthetic token",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    },
  ],
  ...(!req.params?.cursor ? { nextCursor: "page2" } : {}),
}));
s.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        cwd: process.cwd(),
        value: process.env.FIXTURE_VALUE,
      }),
    },
  ],
}));
s.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ uri: "tokens://palette", name: "Palette" }],
}));
s.setRequestHandler(ReadResourceRequestSchema, async (req) => ({
  contents: [{ uri: req.params.uri, text: "blue" }],
}));
s.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [{ name: "design", description: "Synthetic design prompt" }],
}));
s.setRequestHandler(GetPromptRequestSchema, async () => ({
  messages: [
    { role: "user", content: { type: "text", text: "Use the local palette" } },
  ],
}));
await s.connect(new StdioServerTransport());
