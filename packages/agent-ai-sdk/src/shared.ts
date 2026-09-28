import type {
    HttpChatTransportInitOptions,
    UIMessage,
    UIMessageChunk,
} from "ai";
import {
    createAgentClient,
    parseAgentSse,
    type AgentChatMessage,
    type AgentClient,
    type AgentClientConfig,
    type AgentEvent,
} from "@metabindai/agent-core";
import {
    agentEventsToUIMessageChunks,
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
     * Hidden steering text sent as a non-displayed leading `user` message
     * on a conversation's first request, and again on any later turn where
     * its value has changed (the proxy keeps it in the stored history in
     * between). The proxy holds the real system prompt server-side; this is
     * the client-side escape hatch for per-session context (e.g. a demo
     * scenario) that should reach the model but never appear in the UI
     * thread. Pass a getter to resolve it lazily (e.g. from sessionStorage)
     * on each turn.
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
// The proxy expects plain `{role, content}` messages and appends them to the
// history it stores for `conversationId` (tool calls and results included).
// So the full text history goes out only until the proxy has stored the
// conversation; after that each turn sends just the newest user message, as
// the Apple and Android SDKs do. Replaying earlier turns would duplicate
// them in the model's context on every turn.
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

function newestUserMessage(messages: UIMessage[]): AgentChatMessage[] {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return toAgentMessages([messages[i]]);
    }
    return [];
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
 * stream itself doesn't repeat the id on every event. `onAgentEvent`
 * sees every proxy event so the transport can track which conversations
 * the proxy has stored.
 */
export function buildTransportInit(opts: MetabindAgentTransportOptions): {
    init: HttpChatTransportInitOptions<UIMessage>;
    getConversationId: () => string;
    onAgentEvent: (event: AgentEvent) => void;
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
    // Conversation ids the proxy holds a stored history for. Marked on
    // `message_start`, which the proxy sends only after the request passed
    // validation; unmarked if the turn that would have created the record
    // ends in an `error` event, since the proxy stores only turns that
    // complete. A turn the user stops is still completed and stored.
    const storedConversations = new Set<string>();
    // Leading context the proxy last received for each conversation.
    const storedContext = new Map<string, string | undefined>();
    let currentConversationId = "";
    let currentWasStored = false;
    let currentContext: string | undefined;
    return {
        init: {
            api: chatUrl,
            headers: async () => ({
                Authorization: `Bearer ${
                    typeof apiKey === "function" ? await apiKey() : apiKey
                }`,
            }),
            prepareSendMessagesRequest: ({ id, messages }) => {
                const resumed = storedConversations.has(id);
                currentConversationId = id;
                currentWasStored = resumed;
                const userMessageIndex = messages.filter(
                    (m) => m.role === "user",
                ).length;
                onSendMessage?.({
                    conversationId: id,
                    messageCount: messages.length,
                    userMessageIndex,
                });
                const agentMessages = resumed
                    ? newestUserMessage(messages)
                    : toAgentMessages(messages);
                const ctx = resolveLeadingContext();
                currentContext = ctx;
                if (ctx && (!resumed || storedContext.get(id) !== ctx)) {
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
        onAgentEvent: (event) => {
            if (event.type === "message_start") {
                storedConversations.add(currentConversationId);
                storedContext.set(currentConversationId, currentContext);
            } else if (event.type === "error" && !currentWasStored) {
                storedConversations.delete(currentConversationId);
            }
        },
        onToolCalled: opts.onToolCalled,
        onTurnUsage: opts.onTurnUsage,
    };
}

async function* observe(
    events: AsyncIterable<AgentEvent>,
    onEvent: (event: AgentEvent) => void,
): AsyncGenerator<AgentEvent> {
    for await (const event of events) {
        onEvent(event);
        yield event;
    }
}

/**
 * Wraps the proxy's SSE stream as `UIMessageChunk`s, reports each proxy
 * event to `onAgentEvent`, and stamps the current conversation id onto
 * each forwarded `onToolCalled` event.
 */
export function processAgentStream(
    stream: ReadableStream<Uint8Array>,
    getConversationId: () => string,
    onAgentEvent: (event: AgentEvent) => void,
    onToolCalled: ((info: ToolCalledTransportInfo) => void) | undefined,
    onTurnUsage: ((info: TurnUsageInfo) => void) | undefined,
): ReadableStream<UIMessageChunk> {
    const events = observe(parseAgentSse(stream), onAgentEvent);
    return agentEventsToUIMessageChunks(events, {
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
