// `@metabindai/agent-shell` — the host-side presentation shell.
//
// What a consumer renders on their own page: a shell that embeds the chat
// (`@metabindai/agent-ui`) in an iframe and morphs between a centered modal, a
// docked right sidebar, and a minimized pill. It owns the iframe bridge —
// seeding conversation context on load (INIT) and re-surfacing a tool's dock
// signal (DOCK) as React callbacks. The consumer serves `<AgentChat>` at a
// same-origin route and points the shell at it via `chatUrl`.
//
// The bridge wire protocol lives in the chat package and is re-exported here
// for convenience; it's also directly available at
// `@metabindai/agent-ui/protocol`.

export * from "./src/shell";

// Re-export the bridge contract so hosts can `import { ... } from
// "@metabindai/agent-shell"` without also reaching into the chat package.
export {
    type DockMode,
    type DockSignalDetail,
    type ChatInitDetail,
    postInit,
    parseInit,
    postDockSignal,
    parseDockSignal,
    useDockSignal,
    postReady,
    parseReady,
} from "@metabindai/agent-ui/protocol";
