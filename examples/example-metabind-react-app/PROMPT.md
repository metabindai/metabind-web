# Customising this Metabind React example

You're an agent helping the user customise a working React chat app that's already wired to a Metabind project's agent proxy and MCP endpoint. This is **not** a build-from-scratch spec — the repo already runs. Your job is to make targeted edits and resist rebuilding things from scratch.

Before any code edit, read `README.md` for the runtime layout, then this file for how to approach changes.

---

## Tools to keep in your back pocket

- **`metabind` CLI** is installed (`metabind --help`). When the user needs an org id, project id, MCP URL, or API key, prefer the CLI over asking them to dig through the dashboard:
  - `metabind status` — current org + project bound to the CLI
  - `metabind url` — MCP endpoint for the bound project
  - `metabind api-key create` — mint a fresh project API key
  - `metabind init` — bootstrap a new org + project if there isn't one yet
  - `metabind tool list` / `metabind content list` — inspect what the project exposes; helpful when you're writing starter prompts that hit specific tools
- **`.env.local`** is where credentials live (`VITE_METABIND_ORG_ID`, `VITE_METABIND_PROJECT_ID`, `VITE_METABIND_API_KEY`, plus optional `VITE_METABIND_AGENT_BASE_URL` / `VITE_METABIND_MCP_BASE_URL` overrides — both default to production). `src/config.ts` throws if any of the required three are missing — that's intentional, don't add silent fallbacks.
- **`pnpm dev`** for live development. `pnpm build` is vite-only (no `tsc` step) — typecheck mistakes only show up at runtime.

---

## How the pieces fit together

The chat lives on top of two distinct Metabind endpoints. Don't conflate them:

| Endpoint | Used by | File |
| --- | --- | --- |
| `agent.metabind.ai/<org>/<project>/chat` (SSE) | the chat itself | `src/agent.ts` → `src/app.tsx` |
| `mcp.metabind.ai/<org>/projects/<project>` (MCP over HTTP) | tool metadata + tools/call forwarding from UI iframes | `src/mcp.ts` → `src/mcp-ui-context.tsx`, `src/components/tool-app-view.tsx` |

The agent proxy handles the LLM, tool dispatch, and SSE streaming. The MCP client is only there because (a) we need each tool's `_meta` to know which ones have UI resources, and (b) when a UI iframe wants to call another tool, we forward that through the MCP client, not the agent proxy.

`assistant-ui` provides primitives only — there's no default `<Thread />`. `src/components/assistant-ui/thread.tsx` is the composed Thread; that's where rendering changes go.

---

## Common customisations

### Rebrand the welcome screen

Edit `ThreadWelcome` in `src/components/assistant-ui/thread.tsx`. Drop in starter prompts by adding a `ThreadSuggestions`-style block that calls `aui.thread().append({ role: "user", content: [{ type: "text", text: prompt }] })` from `useAui()`.

### Point at a different Metabind project

Update `.env.local`. No code changes. If you need to bind to a project the CLI doesn't know about, run `metabind use` and pick from the menu, then re-read `metabind status`.

### Change the visual theme

The palette lives in `src/globals.css` as oklch CSS custom properties under `:root` and `.dark` (`--background`, `--foreground`, `--muted`, `--border`, `--primary`, `--ring`, `--destructive`, `--radius`). Update those and the rest of the UI re-skins.

For deeper tweaks, the shadcn primitives in `src/components/ui/` are local files — edit them like any other component.

### Add or remove markdown features

`src/components/assistant-ui/markdown-text.tsx` wires `remarkPlugins={[remarkGfm]}`. Plugins go in that array. Per-element style overrides live in the `defaultComponents` object passed to `MarkdownTextPrimitive`. The function is wrapped in `memo` and uses `unstable_memoizeMarkdownComponents` — keep those.

### Add a custom UI for one specific tool

Tool fallback rendering is in `src/components/assistant-ui/tool-fallback.tsx`. To render a different UI per tool, edit `tool-fallback.tsx` to branch on `toolName`, or register a per-tool component via `MessagePrimitive.Parts` `components={{ tools: { by_name: { my_tool: MyComponent } } }}` in `thread.tsx`'s `AssistantMessage` (the relevant call site is the `<MessagePrimitive.GroupedParts>` render function, branch `case "tool-call"`).

### Wire analytics

The transport accepts `onSendMessage`, `onToolCalled`, `onTurnUsage` callbacks (`src/app.tsx` is currently passing the bare `{ client }` so all three are unused). Add the callback you want — that's the seam.

If you want per-tool duration or per-turn token usage rendered in the tool-call cards, that's not free: you need a state store (`tool-call-timings.ts` / `token-usage.ts` were in an earlier draft of this example), a message-level `useEffect` that pumps timings into the store as parts transition `running → complete`, and hooks in `tool-fallback.tsx` to read them. The transport's `onTurnUsage` provides the token info; the duration info comes from watching the part status.

### Add the LLM follow-up-suggestions block back

It used to live in `thread.tsx`. The pattern: subscribe to `s.thread.messages`, debounce on `isRunning`, call `agentClient.chatText({...})` with a shaping instruction + recent turn context, parse a JSON array out of the reply, render as buttons that call `aui.thread().append(...)`. Don't put the instruction in a system prompt — the proxy doesn't accept one; embed it in the user message.

### Inject temporal context (or any other ambient state)

If the model needs to know the current date/time, the user's locale, location, feature flags, etc. — anything ambient that isn't part of what the user typed — wrap the client in `src/agent.ts`, don't touch the assistant-ui message store.

```ts
const baseClient = createAgentClient({ ...metabindAgentConfig });

function withCurrentDateTime(req: AgentChatRequest): AgentChatRequest {
    const lastIndex = req.messages.length - 1;
    if (lastIndex < 0) return req;
    const last = req.messages[lastIndex];
    if (last.role !== "user") return req;
    const stamp = new Date().toLocaleString(undefined, {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
    return {
        ...req,
        messages: [
            ...req.messages.slice(0, lastIndex),
            { ...last, content: `[Current date/time: ${stamp}]\n\n${last.content}` },
        ],
    };
}

export const agentClient: AgentClient = {
    ...baseClient,
    chat: (req, signal) => baseClient.chat(withCurrentDateTime(req), signal),
    chatText: (req, signal) => baseClient.chatText(withCurrentDateTime(req), signal),
    fetchChat: (req, signal) => baseClient.fetchChat(withCurrentDateTime(req), signal),
};
```

Two things to get right:

- **Wrap all three methods.** `chat` handles the streaming chat runtime; `chatText` covers the follow-up-suggestions path; `fetchChat` is the escape hatch. If you only wrap `chat`, anything calling `chatText` slips through without the context.
- **Append to the *last* user message, not a synthetic new turn.** The proxy's message schema is `user | assistant` only — no system role — so the context rides along inside the user turn. Don't prepend to the assistant-ui store's message either; that mutates the UI history. The wire payload is the only place this belongs.

---

## Things you almost certainly shouldn't touch

These exist because of specific upstream quirks. Touch them and the chat will subtly break.

- **`src/mcp.ts` fetch shim** — the `boundFetch` wrapper strips the `User-Agent` header before forwarding to `window.fetch`. Metabind's MCP server doesn't whitelist the AI SDK's UA-suffix header and the CORS preflight fails. It also rebinds `fetch` because the bare `globalThis.fetch` reference throws in browsers ("Can only call Window.fetch on instances of Window").
- **`STARTUP_TIMEOUT_MS` in `src/mcp.ts`** — some MCP servers 405 the optional SSE notifications GET and the SDK can hang forever on startup. The 15s race is what makes that recoverable.
- **`_meta` extraction in `src/mcp-ui-context.tsx`** — checks both `_meta["ui/resourceUri"]` and `_meta.ui.resourceUri`; different MCP servers emit different shapes. Keep both lookups.
- **`public/sandbox_proxy.html`** — the iframe sandbox boundary `AppRenderer` mounts tool HTML inside. Same-origin requirement; can't be replaced by an inline `srcdoc` without breaking `postMessage` flows. ~30 lines, static, leave alone.

---

## Don't reinvent

When the user asks for something, check the repo first. The example already ships:

- Reasoning UI (`src/components/assistant-ui/reasoning.tsx`)
- Tool grouping (`src/components/assistant-ui/tool-group.tsx`)
- Tool fallback with collapsible args/result (`src/components/assistant-ui/tool-fallback.tsx`)
- Attachments (`src/components/assistant-ui/attachment.tsx`)
- Action bar with copy / reload / export-markdown (`thread.tsx` → `AssistantActionBar`)
- Branch picker (`thread.tsx` → `BranchPicker`)
- Edit composer (`thread.tsx` → `EditComposer`)
- Markdown with GFM + dot streaming indicator + memoized components (`markdown-text.tsx`)
- MCP UI rendering inline with tool calls (`tool-app-view.tsx` + `mcp-ui-context.tsx`)
- Stalled / thinking indicators (`thread.tsx`)

If the user asks for one of these, point them at the file rather than rebuilding.

---

## When you're stuck

`metabind feedback verb_unclear "..."` files a report against the CLI. If the user hits an MCP or agent-side bug, that's the route. For UI bugs in this example, the upstream `assistant-ui` and `@mcp-ui/client` repos are where you go.
