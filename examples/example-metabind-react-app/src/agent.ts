// Singleton `@metabindai/agent-core` client used by the chat runtime in
// `app.tsx`. Configuration comes from `src/config.ts` (which reads
// `import.meta.env.VITE_*`).

import {
    createAgentClient,
    type AgentClient,
    type AgentClientConfig,
} from "@metabindai/agent-core";
import { AGENT_BASE_URL, METABIND_TOKEN, ORG_ID, PROJECT_ID } from "@/config";

export const metabindAgentConfig: AgentClientConfig = {
    baseUrl: AGENT_BASE_URL,
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    apiKey: METABIND_TOKEN,
};

export const agentClient: AgentClient = createAgentClient(metabindAgentConfig);
