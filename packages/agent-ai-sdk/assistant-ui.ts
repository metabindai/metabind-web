// Subpath entry for assistant-ui consumers — drops into
// `useChatRuntime({ transport })` from `@assistant-ui/react-ai-sdk`.

export { MetabindAgentTransport } from "./src/assistant-ui";

export type {
    MetabindAgentTransportOptions,
    SendMessageInfo,
    ToolCalledTransportInfo,
} from "./src/shared";

export type {
    AgentChunkOptions,
    ToolCalledInfo,
    TurnTool,
    TurnUsageInfo,
} from "./src/chunks";
