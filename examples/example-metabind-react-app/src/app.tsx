"use client";

import { AgentChat, configureChat } from "@metabindai/agent-ui";
import {
    ORG_ID,
    PROJECT_ID,
    METABIND_TOKEN,
    AGENT_BASE_URL,
    MCP_BASE_URL,
} from "./config";

// Configure the chat once, at module load, before <AgentChat /> mounts. The
// whole chat surface — assistant-ui runtime, MetabindAgentTransport, and MCP UI
// tool rendering — comes from @metabindai/agent-ui.
configureChat({
    agent: {
        baseUrl: AGENT_BASE_URL,
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        apiKey: METABIND_TOKEN,
    },
    mcp: { baseUrl: MCP_BASE_URL },
    // sandbox_proxy.html is served from this app's public/ root.
    sandboxUrl: "/sandbox_proxy.html",
    welcome: {
        title: "How can I help?",
        subtitle: "Ask me anything — I can use the tools wired to this project.",
    },
});

export default function App() {
    return <AgentChat />;
}
