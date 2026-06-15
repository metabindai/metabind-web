"use client";

import { useMemo } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { McpUiProvider } from "@/mcp-ui-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { MetabindAgentTransport } from "@metabindai/agent-ai-sdk/assistant-ui";
import { agentClient } from "@/agent";

export default function App() {
    // The transport also accepts `onSendMessage`, `onToolCalled`, and
    // `onTurnUsage` callbacks — wire them here if you want analytics or
    // per-tool latency / token attribution.
    const transport = useMemo(
        () => new MetabindAgentTransport({ client: agentClient }),
        [],
    );

    const runtime = useChatRuntime({ transport });

    return (
        <TooltipProvider>
            <AssistantRuntimeProvider runtime={runtime}>
                <McpUiProvider>
                    <div className="flex h-screen flex-col bg-background">
                        <Thread />
                    </div>
                </McpUiProvider>
            </AssistantRuntimeProvider>
        </TooltipProvider>
    );
}
