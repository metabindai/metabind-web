# Metabind for Web

The web SDK for Metabind. Embed a governed agent in your React app — as a drop-in chat surface or through lower-level building blocks.

## What this is

Metabind is the hosted platform for [Model Context Protocol (MCP)](https://modelcontextprotocol.io) Apps: you define the tools, and Metabind runs the server. It turns your existing UI and APIs into a governed agent — a standards-compliant MCP App that understands what each customer came for, renders interactive UI instead of plain text, and runs both inside your own app and across Claude, ChatGPT, and every MCP host. The agent is governed, not autonomous. It follows the system prompt you author, and it can only render components you approved, validated against each tool's schema on every render.

This repository is the web side. It ships four npm packages under the public `@metabindai` scope, adoptable independently — the fastest path is `@metabindai/agent-ui`'s `<AgentChat />`; the others are the layers underneath it:

| Package | npm | Path |
| --- | --- | --- |
| Agent client | [`@metabindai/agent-core`](https://www.npmjs.com/package/@metabindai/agent-core) | `packages/agent-core` |
| AI SDK adapter | [`@metabindai/agent-ai-sdk`](https://www.npmjs.com/package/@metabindai/agent-ai-sdk) | `packages/agent-ai-sdk` |
| Chat UI | [`@metabindai/agent-ui`](https://www.npmjs.com/package/@metabindai/agent-ui) | `packages/agent-ui` |
| Host shell | [`@metabindai/agent-shell`](https://www.npmjs.com/package/@metabindai/agent-shell) | `packages/agent-shell` |
| Example React app | — | `examples/example-metabind-react-app` |

- `@metabindai/agent-core` is a framework-agnostic client that streams typed events
  from the Metabind agent proxy (`agent.metabind.ai/:orgId/:projectId/chat`).
- `@metabindai/agent-ai-sdk` is a Vercel AI SDK transport for `useChat`, with an
  assistant-ui flavour exported from `@metabindai/agent-ai-sdk/assistant-ui`. It
  depends on `@metabindai/agent-core`.
- `@metabindai/agent-ui` is a prebuilt, drop-in React chat UI (assistant-ui
  runtime + `MetabindAgentTransport` + MCP UI tool rendering). Configure it and
  render `<AgentChat />`. Works standalone or embedded. It also ships the iframe
  bridge contract at `@metabindai/agent-ui/protocol`.
- `@metabindai/agent-shell` is the host-side presentation shell (modal/sidebar/pill)
  that embeds `<AgentChat>` in a same-origin iframe and re-surfaces the bridge
  signals as React callbacks. It depends on `@metabindai/agent-ui`.

All are published with `publishConfig.access = public`.

> [!NOTE]
> On the web, Interactive Tool output renders in sandboxed iframes via [`@mcp-ui/client`](https://www.npmjs.com/package/@mcp-ui/client). Native SwiftUI and Jetpack Compose rendering through BindJS lives in the mobile SDKs below.

## The Metabind SDKs

| Platform | Repository |
|---|---|
| iOS, macOS, visionOS | [`metabind-apple`](https://github.com/metabindai/metabind-apple) |
| Android | [`metabind-android`](https://github.com/metabindai/metabind-android) |
| Web (React) | `metabind-web` — this repository |

One MCP App serves all three: the same tools, components, and agent configuration from a single publish, so the SDKs compose — ship the web chat surface and the mobile assistants together.

**[🚀 Start free at metabind.ai](https://metabind.ai)** · **[📖 Read the docs](https://docs.metabind.ai)**

## Documentation

To integrate the chat into your app, follow the [Web SDK guide](https://docs.metabind.ai/guides/assistant-sdk/web-sdk) — it covers the quick start from the example app, adding `<AgentChat />` to an existing app (including the `sandbox_proxy.html` the tool rendering requires), every `configureChat` option, the modal/sidebar/pill shell, and the lower-level clients. See also [LLM provider configuration](https://docs.metabind.ai/guides/assistant-sdk/llm-provider-configuration) for key custody, and the [Assistant SDK overview](https://docs.metabind.ai/guides/getting-started/embed-an-assistant) for when to embed versus connect to an external MCP host.

## Develop

```sh
pnpm install
pnpm build      # builds agent, then agent-ai-sdk (topological)
pnpm test       # vitest suites
```

## Example app

`examples/example-metabind-react-app` is a minimal, clone-and-run chat app — the
smallest thing that stands up a working chat against a Metabind project. It is
**standalone, not a workspace member**: it installs `@metabindai/agent-ui` from
npm (not a workspace link), so it behaves exactly like a fresh download for an
external consumer. Copy the folder out on its own and it runs.

```sh
cd examples/example-metabind-react-app
pnpm install                       # pulls @metabindai/agent-ui from npm
cp .env.example .env.local         # fill in org id, project id, API key
pnpm dev
```

See the example's own README for details. Because it's not workspace-linked,
local package edits don't flow into it — publish (or point it at a local build)
to test changes there.

## Consuming from another repo during development

These packages are published to npm, but you can point a consumer at this local
checkout via pnpm overrides instead of publishing on every change:

```jsonc
// consumer root package.json
"pnpm": {
  "overrides": {
    "@metabindai/agent-core":        "link:../metabind-packages/metabind-web/packages/agent-core",
    "@metabindai/agent-ai-sdk": "link:../metabind-packages/metabind-web/packages/agent-ai-sdk"
  }
}
```

## Publishing

```sh
npm login                       # @metabindai org
pnpm --filter @metabindai/agent-core   build && npm publish -w packages/agent-core
pnpm --filter @metabindai/agent-ai-sdk build && npm publish -w packages/agent-ai-sdk
pnpm --filter @metabindai/agent-ui     build && npm publish -w packages/agent-ui
npm publish -w packages/agent-shell    # source-only, no build step
```

`ai`, `@ai-sdk/react`, and `@assistant-ui/react-ai-sdk` are **peer dependencies**
of `@metabindai/agent-ai-sdk` — consumers provide them. `react` / `react-dom` are
peer dependencies of `@metabindai/agent-ui` and `@metabindai/agent-shell`.

`@metabindai/agent-ui` and `@metabindai/agent-shell` ship as TypeScript/TSX
**source** (their entry is `index.ts`) — consumers compile them through their own
bundler. `agent-ui` also ships a prebuilt `agent-ui.css` (Tailwind v4) for apps
that don't want to run Tailwind themselves; see its README.

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
