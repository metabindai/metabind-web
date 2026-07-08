// Public types for the Metabind agent proxy contract.
//
// The proxy holds the LLM provider key and project agent settings; clients
// post `messages` and receive an Anthropic-style SSE stream where text and
// tool blocks interleave within a single assistant turn. Tool execution
// happens server-side — the client receives `tool_use` (full input) and
// `tool_result` (CallToolResult-shaped content) events.
//
// Tool-input streaming (added in metabind-agent PR #16, MET-1093):
// providers also emit `tool_use_start` once the id+name are known and
// 0..N `tool_use_input_delta` events with raw JSON-fragment deltas as
// the LLM produces the tool input. The atomic `tool_use` still arrives
// at the end with the complete input, so older consumers that ignore the
// new events keep working.
//
// These types are intentionally framework-agnostic. AI-SDK / assistant-ui /
// React-specific helpers live in `@metabindai/agent-ai-sdk`.

export type AgentRole = "user" | "assistant";

export type AgentChatMessage = {
    role: AgentRole;
    content: string;
};

/** Content block inside a `tool_result` event. Mirrors MCP's CallToolResult.content. */
export type AgentToolResultContent =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: string; [k: string]: unknown };

export type AgentUsage = {
    inputTokens: number;
    outputTokens: number;
};

/** Discriminated union of every event the proxy emits. */
export type AgentEvent =
    | { type: "message_start"; conversationId?: string }
    | { type: "text_delta"; text: string }
    | { type: "tool_use_start"; id: string; name: string }
    | { type: "tool_use_input_delta"; id: string; partialInput: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | {
          type: "tool_result";
          toolUseId: string;
          content: AgentToolResultContent[];
          isError?: boolean;
      }
    | { type: "message_stop"; stopReason?: string; usage?: AgentUsage }
    | { type: "error"; message: string }
    /** Forward-compatible escape hatch for events added by future proxy versions. */
    | { type: string; [k: string]: unknown };

/** Body of a POST `/:orgId/:projectId/chat` request. */
export type AgentChatRequest = {
    messages: AgentChatMessage[];
    /** Optional client-supplied id; the proxy will assign one if omitted. */
    conversationId?: string;
    /** Defaults to `true` — the proxy currently only supports streaming. */
    stream?: boolean;
    /**
     * Target the project's draft (unpublished) MCP server instead of the
     * published one (MET-1271). Defaults to `false`. The proxy pins this to the
     * conversation on its first turn — a later turn that flips it is rejected,
     * so switching targets requires a fresh `conversationId`.
     */
    draft?: boolean;
};

export type AgentClientConfig = {
    /** Base URL. Defaults to `https://agent.metabind.ai`. Use `agent-dev.metabind.ai` for dev. */
    baseUrl?: string;
    orgId: string;
    projectId: string;
    /** Metabind project API key. Pass a getter to support refresh / lazy init. */
    apiKey: string | (() => string | Promise<string>);
    /** Custom fetch (for testing / SSR). Defaults to `globalThis.fetch`. */
    fetch?: typeof fetch;
};
