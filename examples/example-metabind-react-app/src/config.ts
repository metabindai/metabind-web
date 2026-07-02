// Read-once env config. Vite inlines `import.meta.env.VITE_*` at build time,
// so these end up as string literals in the bundle — same security profile
// as `Authorization: Bearer …` on every browser request. Acceptable for
// project-scoped Metabind API keys, NOT for raw LLM-provider credentials.

const env = import.meta.env;

function required(name: string): string {
    const v = env[name];
    if (typeof v !== "string" || v.length === 0) {
        throw new Error(
            `Missing required env var ${name}. Copy .env.example to .env.local and fill it in. ` +
                `See README.md for how to obtain values via the metabind CLI.`,
        );
    }
    return v;
}

export const ORG_ID = required("VITE_METABIND_ORG_ID");
export const PROJECT_ID = required("VITE_METABIND_PROJECT_ID");
export const METABIND_TOKEN = required("VITE_METABIND_API_KEY");

// Optional overrides — defaults are the production Metabind endpoints.
export const AGENT_BASE_URL =
    env.VITE_METABIND_AGENT_BASE_URL || "https://agent.metabind.ai";
export const MCP_BASE_URL =
    env.VITE_METABIND_MCP_BASE_URL || "https://mcp.metabind.ai";
