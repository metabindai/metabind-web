# example-metabind-react-app

A minimal, **clone-and-run** chat app built on the published Metabind packages —
the smallest thing that stands up a working chat against a Metabind project.

It's a standalone project: it installs [`@metabindai/agent-ui`](https://www.npmjs.com/package/@metabindai/agent-ui)
from npm (which brings the agent transport, assistant-ui runtime, and MCP UI tool
rendering with it), so you can copy this folder out on its own and run it — no
monorepo required.

The whole app is three files:

```
src/
├── main.tsx     mounts <App/> and imports the prebuilt chat stylesheet
├── app.tsx      configureChat({ agent, mcp, welcome }) + <AgentChat/>
└── config.ts    reads env vars (org id, project id, API key, base URLs)
public/
└── sandbox_proxy.html   iframe sandbox that MCP UI tool surfaces render into
```

## Get it

```bash
# grab just this folder (or clone the repo and copy it out)
npx degit metabindai/metabind-web/examples/example-metabind-react-app my-metabind-chat
cd my-metabind-chat
pnpm install      # pulls @metabindai/agent-ui from npm
```

## Configure

You need three values: org id, project id, and a project-scoped API key. The
fastest path is the [`metabind` CLI](https://www.npmjs.com/package/metabind):

```bash
metabind auth login          # authenticate against your Metabind account
metabind use                 # bind to a project (or `metabind init` to create one)
metabind status              # read the bound projectId + orgId
metabind api-key create      # mint a project API key
```

Then copy `.env.example` to `.env.local` and fill in:

```
VITE_METABIND_ORG_ID=...
VITE_METABIND_PROJECT_ID=...
VITE_METABIND_API_KEY=...
```

(`VITE_METABIND_AGENT_BASE_URL` / `VITE_METABIND_MCP_BASE_URL` are optional
overrides — they default to the production Metabind endpoints.)

## Run

```bash
pnpm dev          # http://localhost:5173
pnpm build        # static bundle to dist/
```

The agent proxy is the backend — there's no Node-side code here. The API key is
inlined into the browser bundle (same profile as a `Bearer` header on every
request); that's fine for a **project-scoped** Metabind key, not for raw
LLM-provider secrets.

## Customising

The chat is configured, not composed — see `app.tsx`. Common knobs on
`configureChat`:

- `welcome: { title, subtitle, tiles }` — the empty-state hero + starter-prompt tiles
- `debug: true` (or `?debug=1` in the URL) — show raw tool-call args/results
- `allowAttachments: true` — enable the composer's attach button + dropzone
- `tracer` — per-turn hook for analytics/tracing

To **rebrand the look**, this app uses the package's prebuilt stylesheet
(`import "@metabindai/agent-ui/agent-ui.css"` in `main.tsx`). If you're on
Tailwind v4 and want to theme it with your own tokens, swap that import for the
source-CSS approach documented in the
[`@metabindai/agent-ui` README](https://www.npmjs.com/package/@metabindai/agent-ui#styling).

For deeper changes (custom thread layout, message rendering), the package ships
its `src/` — copy the pieces you want to override into your app and import them
locally.
