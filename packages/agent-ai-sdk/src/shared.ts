import type {
    HttpChatTransportInitOptions,
    UIMessage,
    UIMessageChunk,
} from "ai";
import {
    createAgentClient,
    type AgentChatMessage,
    type AgentClient,
    type AgentClientConfig,
} from "@metabindai/agent-core";
import {
    agentSseToUIMessageChunks,
    type ToolCalledInfo,
    type TurnUsageInfo,
} from "./chunks";

export type SendMessageInfo = {
    conversationId: string;
    messageCount: number;
    userMessageIndex: number;
};

export type ToolCalledTransportInfo = ToolCalledInfo & {
    /** The conversation id from the most recent outbound request — the SSE
     *  stream itself carries no per-call conversation reference, so we
     *  stamp it here from the request context. */
    conversationId: string;
};

export type MetabindAgentTransportOptions = (
    /** Pass an existing client — share one instance with `chatText` callers. */
    | { client: AgentClient }
    /** Or pass config and let the transport create its own client. */
    | AgentClientConfig
) & {
    /**
     * Hidden steering text prepended as a non-displayed leading `user`
     * message on every outbound request. The proxy holds the real system
     * prompt server-side; this is the client-side escape hatch for
     * per-session context (e.g. a demo scenario) that should reach the
     * model but never appear in the UI thread. Pass a getter to resolve
     * it lazily (e.g. from sessionStorage) on each turn.
     */
    leadingContext?: string | (() => string | undefined);
    /**
     * Target the project's draft (unpublished) MCP server instead of the
     * published one (MET-1271). Sent on every outbound `/chat` request; the
     * proxy pins it to the conversation on the first turn, so callers that let
     * the user toggle this must start a fresh conversation on change.
     */
    draft?: boolean;
    /** Fires once per outbound user turn — used for analytics. */
    onSendMessage?: (info: SendMessageInfo) => void;
    /** Fires when a tool_result lands on the SSE stream. The runtime
     *  doesn't expose per-tool success/latency at the message-part level
     *  (parts have `running` / `complete` / `incomplete` but no clean
     *  timing handle), so analytics callers wire this instead. Buffered
     *  until `message_stop` so `onTurnUsage` runs first and the consumer
     *  can resolve token attribution from inside this callback. */
    onToolCalled?: (info: ToolCalledTransportInfo) => void;
    /** Fires once per assistant turn with the proxy's token usage and
     *  the tools observed in that turn. */
    onTurnUsage?: (info: TurnUsageInfo) => void;
};

// ---------------------------------------------------------------------------
// UIMessage → AgentChatMessage conversion
//
// The proxy expects plain `{role, content}` messages. Tool calls and tool
// results that appeared in earlier turns aren't re-sent — they were
// proxy-internal, and the assistant's *text* response is what the model
// needs to see when continuing the conversation.
// ---------------------------------------------------------------------------

function flattenToText(message: UIMessage): string {
    return message.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .filter(Boolean)
        .join("\n");
}

function toAgentMessages(messages: UIMessage[]): AgentChatMessage[] {
    return messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
            role: m.role as "user" | "assistant",
            content: flattenToText(m),
        }))
        .filter((m) => m.content.length > 0);
}

function resolveClient(opts: MetabindAgentTransportOptions): AgentClient {
    return "client" in opts ? opts.client : createAgentClient(opts);
}

/**
 * Shared init for both transport flavours. Returns the
 * `HttpChatTransportInitOptions` to hand to `super(...)`, plus a
 * `getConversationId` accessor — `prepareSendMessagesRequest` stamps the
 * current id into a closed-over variable and `processResponseStream`
 * reads it back when wrapping `onToolCalled` events, since the SSE
 * stream itself doesn't repeat the id on every event.
 */
export function buildTransportInit(opts: MetabindAgentTransportOptions): {
    init: HttpChatTransportInitOptions<UIMessage>;
    getConversationId: () => string;
    onToolCalled: ((info: ToolCalledTransportInfo) => void) | undefined;
    onTurnUsage: ((info: TurnUsageInfo) => void) | undefined;
} {
    const client = resolveClient(opts);
    const { chatUrl, apiKey } = client.config;
    const onSendMessage = opts.onSendMessage;
    const draft = opts.draft;
    const leadingContext = opts.leadingContext;
    const resolveLeadingContext = (): string | undefined => {
        const v =
            typeof leadingContext === "function"
                ? leadingContext()
                : leadingContext;
        return v && v.trim().length > 0 ? v : undefined;
    };
    let currentConversationId = "";
    return {
        init: {
            api: chatUrl,
            headers: async () => ({
                Authorization: `Bearer ${
                    typeof apiKey === "function" ? await apiKey() : apiKey
                }`,
            }),
            prepareSendMessagesRequest: ({ id, messages }) => {
                currentConversationId = id;
                const userMessageIndex = messages.filter(
                    (m) => m.role === "user",
                ).length;
                onSendMessage?.({
                    conversationId: id,
                    messageCount: messages.length,
                    userMessageIndex,
                });
                const agentMessages = toAgentMessages(messages);
                const ctx = resolveLeadingContext();
                if (ctx) {
                    agentMessages.unshift({ role: "user", content: ctx });
                }
                return {
                    body: {
                        messages: agentMessages,
                        conversationId: id,
                        stream: true,
                        // Omit unless set so published conversations send the
                        // bare body the proxy has always accepted.
                        ...(draft ? { draft: true } : {}),
                    },
                };
            },
        },
        getConversationId: () => currentConversationId,
        onToolCalled: opts.onToolCalled,
        onTurnUsage: opts.onTurnUsage,
    };
}

/**
 * Wraps the proxy's SSE stream as `UIMessageChunk`s and stamps the
 * current conversation id onto each forwarded `onToolCalled` event.
 */
export function processAgentStream(
    stream: ReadableStream<Uint8Array>,
    getConversationId: () => string,
    onToolCalled: ((info: ToolCalledTransportInfo) => void) | undefined,
    onTurnUsage: ((info: TurnUsageInfo) => void) | undefined,
): ReadableStream<UIMessageChunk> {
    return agentSseToUIMessageChunks(stream, {
        onToolCalled: onToolCalled
            ? (info) =>
                  onToolCalled({
                      ...info,
                      conversationId: getConversationId(),
                  })
            : undefined,
        onTurnUsage,
    });
}
