// Metabind agent client, built from the resolved chat config.

import { createAgentClient, type AgentClient } from "@metabindai/agent-core";
import { getChatConfig } from "./config";

export function makeAgentClient(): AgentClient {
    const c = getChatConfig();
    return createAgentClient({
        baseUrl: c.agentBaseUrl,
        orgId: c.orgId,
        projectId: c.projectId,
        apiKey: c.apiKey,
    });
}
