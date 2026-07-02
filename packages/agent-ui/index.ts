// `@metabindai/agent-ui` — a prebuilt, drop-in chat UI for the Metabind agent
// proxy. Bundles the assistant-ui runtime, the MetabindAgentTransport, and MCP
// UI tool rendering (product carousels, cards, etc. rendered in an @mcp-ui
// sandbox). Integration is a few lines: `configureChat({ agent, mcp })` then
// render `<AgentChat />` (or call `mountAgentChat(el, config)`).
//
// Works standalone on a plain page/route, or embedded in a host presentation
// shell (modal/sidebar/pill) via the optional iframe bridge — see
// `@metabindai/agent-ui/protocol`.

export {
    mountAgentChat,
    AgentChat,
    type AgentChatConfig,
    type ChatTracer,
} from "./src/mount";

// Configure the chat without the imperative mount (for consumers that render
// `<AgentChat />` through their own router/root).
export { configureChat, type ApiKeyProvider } from "./src/config";

// Data-driven starter tiles grid — pass to `<DefaultWelcome tiles={...} />`.
export { EmptyStateTiles, type EmptyStateTile } from "./src/empty-state-tiles";

// Building block for custom welcome tiles: a clickable tile that sends its
// `prompt` to the thread. Use in a `configureChat({ welcome })` render fn.
export { StarterTile, type StarterTileProps } from "./src/empty-state-tiles";

// The built-in empty state, props-driven and exported so `configureChat({
// welcome })` can render it directly, compose around it, or pass custom tiles.
export {
    DefaultWelcome,
    type DefaultWelcomeProps,
} from "./src/assistant-ui/thread";

// Conversation context the chat received via the INIT handshake — exposed so an
// injected tracer can tag traces with the live system context, and reuse the
// kickoff sentinel when stripping hidden opener turns.
export { getSystemContext, KICKOFF_SENTINEL } from "./src/context";
