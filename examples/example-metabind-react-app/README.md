# example-metabind-react-app

A working chat app on top of a Metabind project's MCP endpoint, ready to fork as the starting point for your own Metabind-powered React UI.

- Streams from the Metabind agent proxy via [`@metabindai/agent`](https://www.npmjs.com/package/@metabindai/agent) + [`@metabindai/agent-ai-sdk`](https://www.npmjs.com/package/@metabindai/agent-ai-sdk)
- Renders the chat through assistant-ui primitives (composer, scroll-to-bottom, action bar, branch picker, edit composer)
- Renders **MCP UI surfaces** inline: when a tool advertises a `ui/resourceUri` it's loaded into a sandboxed iframe via `@mcp-ui/client`'s `AppRenderer`, with bidirectional `postMessage` so the surface can call other tools or draft text into the composer
- Markdown messages with `remark-gfm`, streaming dot indicator, syntax-highlighted code, reasoning blocks, collapsible tool-call cards
- Tailwind v4 + shadcn primitives for styling

To customise this app (rebrand, swap MCP server, add features), open `PROMPT.md` and follow it — it briefs an agent on the architecture and the safe places to edit.

## Configure

You need three values: org id, project id, and a project-scoped API key. The fastest path is the [`metabind` CLI](https://www.npmjs.com/package/metabind):

```bash
# 1. authenticate the CLI against your Metabind account
metabind auth login

# 2. bind to an existing project, or `metabind init` to create one
metabind use

# 3. read the bound context — copy `projectId` and `orgId`
metabind status

# 4. mint a project API key (records the key once; you can also reuse an existing one)
metabind api-key create
```

Then copy `.env.example` to `.env.local` and fill in:

```
VITE_METABIND_ORG_ID=...
VITE_METABIND_PROJECT_ID=...
VITE_METABIND_API_KEY=...
```

`metabind url` will print the full MCP endpoint for the bound project if you want to sanity-check the org/project halves of the URL.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # static bundle to dist/
```

The agent proxy is the backend — there is no Node-side code here.

## Debugging

- **`?debug=1` query param** flips each tool-call card into the full collapsible view — status pill, raw args JSON, raw result JSON. The default (no flag) shows just an inline `Used <tool>` header so the chat stays clean. Open with `http://localhost:5173/?debug=1` to inspect tool payloads while iterating.
- **Browser console breadcrumbs.** `src/mcp-ui-context.tsx` logs `[mcp-ui] listTools tools:`, `[mcp-ui] serverInfo:`, `[mcp-ui] extract <toolName> _meta=...`, and the final `uiResourceByTool` map. `src/components/tool-app-view.tsx` logs `[tool-app-view] readResource`, `[tool-app-view] resource data`, `[ui tools/call]` (calls forwarded from a UI surface back to MCP), and `[ui message]` (text drafted by a UI surface into the composer). They're verbose by design — they're how you watch the MCP-UI plumbing without a network tab dive. Strip them from `src/` if you don't want them in production.

## Architecture in 30 seconds

```
src/
├── main.tsx              StrictMode mount
├── app.tsx               MetabindAgentTransport → useChatRuntime → AssistantRuntimeProvider
├── config.ts             reads env vars (ORG_ID, PROJECT_ID, API_KEY, base URLs)
├── agent.ts              singleton @metabindai/agent client (chat)
├── mcp.ts                singleton @ai-sdk/mcp client (tool metadata + UI tool_call forwarding)
├── mcp-ui-context.tsx    on mount, listTools() and extracts `_meta["ui/resourceUri"]` → Map
├── components/
│   ├── tool-app-view.tsx  readResource + <AppRenderer> + four iframe callbacks
│   ├── assistant-ui/      thread, composer, action bar, tool-group, tool-fallback, markdown, reasoning, attachment
│   └── ui/                shadcn primitives (button, dialog, tooltip, etc.)
├── lib/
│   └── utils.ts           `cn()`
└── globals.css           Tailwind + shadcn tokens
public/
└── sandbox_proxy.html    iframe sandbox boundary for AppRenderer
```

The two non-obvious pieces are:

1. **There is no default `<Thread />` in assistant-ui** — `src/components/assistant-ui/thread.tsx` composes the primitives manually. Edit there for layout changes, message formatting, reasoning UI, action bar items.

2. **MCP UI rendering is wired separately from the agent.** Chat goes through the agent proxy (`agent.metabind.ai`); the MCP client (`mcp.metabind.ai`) is used purely for tool metadata and forwarding `tools/call` requests received from inside UI iframes. Both auth with the same project API key.
