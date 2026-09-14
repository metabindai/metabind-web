# @metabindai/agent-ui

A prebuilt, drop-in **chat UI** for the Metabind agent proxy: the assistant-ui
runtime, the `MetabindAgentTransport`, and MCP UI tool rendering (product
carousels, cards, etc. rendered in an [`@mcp-ui`](https://github.com/idosal/mcp-ui)
sandbox). Configure it with your Metabind project + key and render `<AgentChat />`.

It works two ways:

- **Standalone** — render it on a normal page/route (what the example app does).
- **Embedded** — serve it at a same-origin route and point a host shell (e.g.
  [`@metabindai/agent-shell`](../agent-shell)) at it via `chatUrl`; the shell
  presents it as a modal/sidebar/pill. The iframe bridge that connects the two
  ships here, at `@metabindai/agent-ui/protocol`.

```bash
pnpm add @metabindai/agent-ui react react-dom
```

## Integration

```tsx
import { AgentChat, configureChat } from "@metabindai/agent-ui";

configureChat({
  agent: { orgId: ORG_ID, projectId: PROJECT_ID, apiKey: METABIND_TOKEN },
  mcp: { baseUrl: "https://mcp.metabind.ai" },
  sandboxUrl: "/sandbox_proxy.html", // see "Static assets" below
  welcome: { title: "How can I help?" },
});

export default function ChatRoute() {
  return <AgentChat />;
}
```

Prefer an imperative mount? `mountAgentChat(el, config)` calls `configureChat`
for you and returns an unmount cleanup.

### Static assets

Copy the files this package ships under [`public/`](./public) into wherever your
app serves static files:

- `sandbox_proxy.html` — the `@mcp-ui/client` sandbox that tool UIs render into.
  Point `configureChat({ sandboxUrl })` at where you serve it.

## Styling

The chat is styled with Tailwind v4. You have two options:

**1. Prebuilt stylesheet (any app, no Tailwind required).** Import the
self-contained CSS this package compiles at build time:

```ts
import "@metabindai/agent-ui/agent-ui.css";
```

It includes a CSS reset (Tailwind preflight), so load it only on the route that
serves the chat — or, when embedded, it's isolated inside the shell's iframe.

**2. Compile it yourself (Tailwind v4 apps).** Theme the chat with your own
tokens by generating its classes through your build:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "tw-shimmer";
@import "@metabindai/agent-ui/styles.css";           /* theme tokens (override to rebrand) */
@source "../node_modules/@metabindai/agent-ui/src";  /* Tailwind skips node_modules otherwise */
```

(The monorepo example app uses this path with the workspace source path
`../../../packages/agent-ui/src`.)

## `configureChat` options

| Field | Required | Notes |
| --- | --- | --- |
| `agent.orgId` / `agent.projectId` / `agent.apiKey` | ✅ | Metabind project + project-scoped API key. Inlined into the browser bundle — fine for a project-scoped key, **not** for raw LLM-provider secrets. |
| `agent.baseUrl` | | Default `https://agent.metabind.ai`. |
| `mcp.baseUrl` | | Default `https://mcp.metabind.ai`. |
| `sandboxUrl` | | Path/URL to `sandbox_proxy.html`. Default `/sandbox_proxy.html`. |
| `welcome` | | Empty-state hero: `{ title?, subtitle?, tilesLabel?, tiles? }`. `tiles` are clickable starter prompts (see `EmptyStateTile`). Default title `"How can I help?"`, no tiles. |
| `tracer` | | Optional per-turn tracing hook (e.g. Langfuse-backed). |
| `context` | | Fallback conversation context when no INIT handshake arrives (chat served standalone, outside a host shell). |
| `autoStart` | | When no `firstPrompt`/`kickoff` is seeded, open the conversation anyway (a hidden opener turn) so the chat never lands on the welcome state — the agent's system prompt drives the greeting. Default `true`; set `false` to keep the welcome state. |
| `autoStartMessage` | | The hidden opener used by `autoStart`. Default `"Hi!"`. |
| `debug` | | Show the developer tool-call display (the "Used N tools" collapsible + raw arg/result cards). `?debug=1` / `?debug=0` overrides at runtime. Default `false`. |
| `allowAttachments` | | Allow attaching media/files in the composer. Default `false`. |
| `origin` | | Expected origin of INIT messages from a host shell. Default: the window origin. |

When embedded, conversation context (system steering / first prompt / greeting /
kickoff) normally arrives at runtime from the host via the INIT handshake — you
don't pass it here.

Besides `firstPrompt` (a visible user opener) and `kickoff` (a hidden
instruction that makes the model open), the context can carry a `greeting`: a
pre-baked assistant opener rendered verbatim the instant the chat mounts, with
no model round-trip. It's a string, or an ordered `GreetingMessage[]` mixing
static text and static UI tool calls (a registered MCP UI tool's surface
rendered from fixed `input` — pass its `resourceUri` inline to skip the
`listTools` discovery round trip; the resource HTML is prefetched immediately).
A greeting is additive: the configured `firstPrompt`/`kickoff`/`autoStart`
still runs afterwards, so the model takes the next turn.

## The iframe bridge — `@metabindai/agent-ui/protocol`

The wire contract shared by the chat and any host shell: the INIT handshake
(host → chat, seeds context), the DOCK signal (chat → host, a tool UI asks to
re-present + hands back an opaque payload), and a READY announcement. Exports
`postInit` / `parseInit`, `postDockSignal` / `parseDockSignal` / `useDockSignal`,
`postReady` / `parseReady`, and the `DockMode` / `DockSignalDetail` /
`ChatInitDetail` types. `@metabindai/agent-shell` is built on it.

## Exports

`configureChat`, `AgentChat`, `mountAgentChat`, `EmptyStateTiles`,
`getSystemContext`, `KICKOFF_SENTINEL`, and the types `AgentChatConfig`,
`WelcomeConfig`, `EmptyStateTile`, `ChatTracer`. The bridge lives on the
`./protocol` subpath.
