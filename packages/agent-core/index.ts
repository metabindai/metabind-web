// Framework-agnostic client for the Metabind agent proxy at
// `agent.metabind.ai/:orgId/:projectId/chat`. Holds no React/AI-SDK deps.
//
// AI-SDK / assistant-ui / React-specific helpers live in
// `@metabindai/agent-ai-sdk`.

export type {
    AgentChatMessage,
    AgentChatRequest,
    AgentClientConfig,
    AgentEvent,
    AgentRole,
    AgentToolResultContent,
    AgentUsage,
} from "./src/types";

export type { AgentClient, ResolvedConfig } from "./src/client";
export { createAgentClient } from "./src/client";

export { parseAgentSse } from "./src/sse";
