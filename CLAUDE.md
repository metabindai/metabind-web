# CLAUDE.md

Guidance for AI agents (and humans) contributing to this repo.

## What this is

The web Assistant SDK for [Metabind](https://metabind.ai) — a pnpm workspace publishing four npm packages under the public `@metabindai` scope, plus a standalone example app. Integration guide: [docs.metabind.ai/guides/assistant-sdk/web-sdk](https://docs.metabind.ai/guides/assistant-sdk/web-sdk).

The packages form a dependency ladder — keep it acyclic and in this order:

```
agent-core  →  agent-ai-sdk  →  agent-ui  →  agent-shell
(SSE client)   (AI SDK transport) (<AgentChat />)  (modal/sidebar/pill host)
```

## Commands

```sh
pnpm install
pnpm build      # topological: agent-core → agent-ai-sdk → agent-ui (css)
pnpm test       # vitest (agent-core src/sse.spec.ts, agent-ai-sdk src/chunks.spec.ts)
```

Do not start dev servers (the example app's `pnpm dev`) from an agent session — they run indefinitely and hang the session. Ask the user to run them in their own terminal.

## Rules that aren't obvious from the code

- **`agent-ui` and `agent-shell` ship as TypeScript source** (entry `index.ts`) — consumers compile them with their own bundler. Don't add a build step to `agent-shell`; `agent-ui`'s only build output is the prebuilt `agent-ui.css` (Tailwind v4).
- **Peer dependencies stay peer**: `react`/`react-dom` (agent-ui, agent-shell); `ai`, `@ai-sdk/react`, `@assistant-ui/react-ai-sdk` (agent-ai-sdk). Moving them to `dependencies` causes duplicate-React failures in consumers.
- **`packages/agent-ui/public/sandbox_proxy.html` is part of the published contract** — consumers copy it into their static hosting; Interactive Tool UIs render inside it via `@mcp-ui/client`. Changes to it or the iframe bridge (`@metabindai/agent-ui/protocol`) affect every consumer.
- **The SSE event vocabulary tracks the hosted Metabind Agent API** (`agent.metabind.ai`). `agent-core`'s event parsing must stay compatible with the proxy's wire format — treat unrecognized-event handling as forward-compatible (ignore, don't throw).
- **The example app is deliberately not workspace-linked.** `examples/example-metabind-react-app` installs `@metabindai/agent-ui` from npm so it behaves like a fresh external download. Local package edits do not flow into it; publish (or point it at a local build) to test changes there.

## Publishing (maintainers)

```sh
pnpm --filter <pkg> build && pnpm --filter <pkg> publish --access public   # agent-shell publishes without a build
```

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
