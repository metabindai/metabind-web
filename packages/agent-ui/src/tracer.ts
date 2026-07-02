// Per-turn tracing hook. The package stays free of any specific tracing vendor
// (e.g. Langfuse) — the host injects an implementation via config.tracer. The
// signatures mirror the MetabindAgentTransport callbacks.

import type {
    SendMessageInfo,
    ToolCalledTransportInfo,
    TurnUsageInfo,
} from "@metabindai/agent-ai-sdk/assistant-ui";

export type ChatTracer = {
    onSend(info: SendMessageInfo): void;
    onTool(info: ToolCalledTransportInfo): void;
    /** `runtime` is the assistant-ui runtime, passed through for thread lookups. */
    onUsage(info: TurnUsageInfo, runtime: unknown): void;
};

export const noopTracer: ChatTracer = {
    onSend() {},
    onTool() {},
    onUsage() {},
};
