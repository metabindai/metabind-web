import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import type { UIMessage, UIMessageChunk } from "ai";
import type { TurnUsageInfo } from "./chunks";
import {
    buildTransportInit,
    processAgentStream,
    type MetabindAgentTransportOptions,
    type ToolCalledTransportInfo,
} from "./shared";

/**
 * `ChatTransport` for the Metabind agent proxy, sized for an
 * assistant-ui runtime. Drops into `useChatRuntime({ transport })` from
 * `@assistant-ui/react-ai-sdk`.
 *
 * Identical wire behaviour to the `MetabindAgentTransport` exported
 * from the package root — extending `AssistantChatTransport` lets the
 * assistant-ui runtime attach its per-thread initialisation hooks.
 */
export class MetabindAgentTransport extends AssistantChatTransport<UIMessage> {
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
