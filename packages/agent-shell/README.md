# @metabindai/agent-shell

The host-side **presentation shell** for the Metabind agent chat: a single panel
that morphs between a centered **modal**, a docked right **sidebar**, and a
minimized **pill**. It embeds the chat ([`@metabindai/agent-ui`](../agent-ui)) in
a same-origin **iframe** — so the chat's CSS is fully isolated from your page —
and owns the [iframe bridge](../agent-ui/src/protocol.ts): it seeds conversation
context on load (INIT) and re-surfaces a tool's dock signal (DOCK) as React
callbacks.

```bash
pnpm add @metabindai/agent-shell @metabindai/agent-ui react react-dom
```

## How it fits together

1. Serve `<AgentChat>` at a **same-origin route** (e.g. `/chat`) — see
   `@metabindai/agent-ui`.
2. Render the shell on your page and point it at that route.

```tsx
import { useAgentShell, AgentShell } from "@metabindai/agent-shell";

function Page() {
  const chat = useAgentShell({
    chatUrl: "/chat",
    context: { systemContext: "The user is on the pricing page." },
    onSignal: (s) => console.log("bridge", s),
  });

  return (
    <>
      <button ref={chat.launchRef} onClick={chat.launch}>
        Ask the assistant
      </button>
      <AgentShell {...chat.shellProps} />
    </>
  );
}
```

`useAgentShell` is the ergonomic path — it owns open/close state, the launch
element ref (the panel grows out of it), and taps the bridge so you don't wire
`postMessage` by hand. Prefer to drive it yourself? Render `<AgentShell>`
directly with your own `open` / `onClose` / `mode`.

## `<AgentShell>` props

| Prop | Notes |
| --- | --- |
| `chatUrl` | Same-origin route serving `<AgentChat>` — becomes the iframe `src`. |
| `open` | Mounts the dock. Toggle `false` to end the session. |
| `title` | Header title. Falls back to `context.title`, then `"Assistant"`. |
| `mode` / `defaultMode` | Controlled or uncontrolled dock mode (`modal` \| `sidebar` \| `pill`). Default `modal`. |
| `onModeChange` | Fires on every mode change (user- or tool-driven). |
| `onDock` | A tool UI in the chat asked to dock; receives `{ mode, payload }`. `payload` is opaque — the bridge doesn't interpret it; use it to sync your own view. |
| `context` | Conversation context seeded into the chat via INIT (`systemContext`, `firstPrompt`, `greeting`, `kickoff`, `title`). `greeting` is a pre-baked assistant opener shown instantly with no model call — a string, or an ordered list of `GreetingMessage` entries (static text and/or a UI tool surface rendered from fixed input); the configured `firstPrompt`/`kickoff` still runs after it. |
| `launchRef` / `launchFrom` | Grow-from origin for the open animation. |
| `onClose` | Ends the session (close button / pill close). |
| `reloadKey` | Bump to remount the iframe and reseed the conversation. |
| `origin` | Expected postMessage origin for the bridge. Default: window origin. |

## Exports

`AgentShell`, `useAgentShell`, the geometry helpers (`SIDEBAR_WIDTH`,
`SIDEBAR_PUSH`, `modalGeom`, `sidebarGeom`, …), and — re-exported for convenience
from `@metabindai/agent-ui/protocol` — the full bridge contract (`postInit`,
`parseDockSignal`, `useDockSignal`, `DockMode`, `DockSignalDetail`,
`ChatInitDetail`, …).
