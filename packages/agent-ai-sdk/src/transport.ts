import { DefaultChatTransport, type UIMessage, type UIMessageChunk } from "ai";
import type { TurnUsageInfo } from "./chunks";
import {
    buildTransportInit,
    processAgentStream,
    type MetabindAgentTransportOptions,
    type ToolCalledTransportInfo,
} from "./shared";

/**
 * `ChatTransport` for the Metabind agent proxy. Drops into
 * `useChat({ transport })` from `@ai-sdk/react`.
 *
 * Reshapes outbound bodies to the proxy's `{messages, conversationId,
 * stream}` shape and translates inbound SSE to the `UIMessageChunk`
 * stream `@ai-sdk/react` expects (text + tool-input-available +
 * tool-output-available, with `providerExecuted: true` so the runtime
 * knows the proxy already executed the tool).
 *
 * For an assistant-ui runtime, import from
 * `@metabindai/agent-ai-sdk/assistant-ui` instead — that subclass extends
 * `AssistantChatTransport` so `useChatRuntime({ transport })`
 * recognises it.
 */
export class MetabindAgentTransport extends DefaultChatTransport<UIMessage> {
    private readonly getConversationId: () => string;
    private readonly onToolCalled?: (info: ToolCalledTransportInfo) => void;
    private readonly onTurnUsage?: (info: TurnUsageInfo) => void;

    constructor(opts: MetabindAgentTransportOptions) {
        const { init, getConversationId, onToolCalled, onTurnUsage } =
            buildTransportInit(opts);
        super(init);
        this.getConversationId = getConversationId;
        this.onToolCalled = onToolCalled;
        this.onTurnUsage = onTurnUsage;
    }

    protected processResponseStream(
        stream: ReadableStream<Uint8Array>,
    ): ReadableStream<UIMessageChunk> {
        return processAgentStream(
            stream,
            this.getConversationId,
            this.onToolCalled,
            this.onTurnUsage,
        );
    }
}
