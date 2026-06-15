// Vercel AI SDK adapter for the Metabind agent proxy.
//
// The main entry targets vanilla `@ai-sdk/react` (`useChat`); for an
// assistant-ui runtime, import from `@metabindai/agent-ai-sdk/assistant-ui`.
//
// Re-exports types from `@metabindai/agent-core` for convenience so users only
// need one import for the typical happy path.

export { MetabindAgentTransport } from "./src/transport";

export type {
    MetabindAgentTransportOptions,
    SendMessageInfo,
    ToolCalledTransportInfo,
} from "./src/shared";

export {
    agentEventsToUIMessageChunks,
    agentSseToUIMessageChunks,
    type AgentChunkOptions,
    type ToolCalledInfo,
    type TurnTool,
    type TurnUsageInfo,
} from "./src/chunks";

export {
    createAgentClient,
    type AgentChatMessage,
    type AgentChatRequest,
    type AgentClient,
    type AgentClientConfig,
    type AgentEvent,
} from "@metabindai/agent-core";
