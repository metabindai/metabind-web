# metabind-web

Web SDKs for the [Metabind](https://metabind.ai) agent proxy, published to npm
under the public `@metabindai` scope.

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
