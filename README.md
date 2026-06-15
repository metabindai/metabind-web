# metabind-web

Web SDKs for the [Metabind](https://metabind.ai) agent proxy, published to npm
under the public `@metabindai` scope.

| Package | npm | Path |
| --- | --- | --- |
| Agent client | [`@metabindai/agent`](https://www.npmjs.com/package/@metabindai/agent) | `packages/agent` |
| AI SDK adapter | [`@metabindai/agent-ai-sdk`](https://www.npmjs.com/package/@metabindai/agent-ai-sdk) | `packages/agent-ai-sdk` |
| Example React app | — | `examples/example-metabind-react-app` |

- `@metabindai/agent` is a framework-agnostic client that streams typed events
  from the Metabind agent proxy (`agent.metabind.ai/:orgId/:projectId/chat`).
- `@metabindai/agent-ai-sdk` is a Vercel AI SDK transport for `useChat`, with an
  assistant-ui flavour exported from `@metabindai/agent-ai-sdk/assistant-ui`. It
  depends on `@metabindai/agent`.

Both are published with `publishConfig.access = public`.

## Develop

```sh
pnpm install
pnpm build      # builds agent, then agent-ai-sdk (topological)
pnpm test       # vitest suites
```

## Example app

`examples/example-metabind-react-app` is a working chat app on top of a Metabind
project's MCP endpoint — a starting point to fork. It consumes the packages via
`workspace:*`, so it always runs against your local checkout (rebuild a package
to see changes).

```sh
pnpm build
cp examples/example-metabind-react-app/.env.example examples/example-metabind-react-app/.env.local
# fill in org id, project id, API key — see the example's README
pnpm --filter example-metabind-react-app dev
```

## Consuming from another repo during development

These packages are published to npm, but you can point a consumer at this local
checkout via pnpm overrides instead of publishing on every change:

```jsonc
// consumer root package.json
"pnpm": {
  "overrides": {
    "@metabindai/agent":        "link:../metabind-packages/metabind-web/packages/agent",
    "@metabindai/agent-ai-sdk": "link:../metabind-packages/metabind-web/packages/agent-ai-sdk"
  }
}
```

## Publishing

```sh
npm login                       # @metabindai org
pnpm --filter @metabindai/agent        build && npm publish -w packages/agent
pnpm --filter @metabindai/agent-ai-sdk build && npm publish -w packages/agent-ai-sdk
```

`ai`, `@ai-sdk/react`, and `@assistant-ui/react-ai-sdk` are **peer dependencies**
of `@metabindai/agent-ai-sdk` — consumers provide them.
