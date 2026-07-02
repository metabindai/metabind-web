import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getChatConfig } from "./config";

let mcpClientPromise: Promise<MCPClient> | undefined;

// Some MCP servers 405 the optional SSE notifications GET, and a few SDK
// versions await that stream during startup — `createMCPClient` then hangs
// forever instead of rejecting. Without a timeout, one bad startup wedges
// the module-scoped singleton for the rest of the page.
const STARTUP_TIMEOUT_MS = 15_000;

// `MCPClient` exposes listTools/readResource but not tools/call. The
// underlying class implements `callTool({ name, args })`, so reach through
// the type. Used to forward tools/call requests from MCP-UI iframes.
type MCPClientWithCallTool = MCPClient & {
    callTool: (args: {
        name: string;
        args?: Record<string, unknown>;
    }) => Promise<CallToolResult>;
};

export async function callMCPTool(
    name: string,
    args?: Record<string, unknown>,
): Promise<CallToolResult> {
    const client = (await getMCPClient()) as MCPClientWithCallTool;
    return client.callTool({ name, args });
}

export async function getMCPClient(): Promise<MCPClient> {
    if (!mcpClientPromise) {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const startup = (async () => {
            const { mcpUrl, apiKey: token } = getChatConfig();
            // The HTTP transport defaults to `globalThis.fetch`, which throws
            // "Can only call Window.fetch on instances of Window" in browsers
            // because the unbound reference loses its receiver. Also: the
            // transport adds a User-Agent suffix header that triggers a CORS
            // preflight the metabind MCP server doesn't whitelist. Strip it.
            const boundFetch: typeof fetch = (input, init) => {
                if (init?.headers) {
                    const h = new Headers(init.headers);
                    h.delete("user-agent");
                    init = { ...init, headers: h };
                }
                return window.fetch(input, init);
            };
            return await createMCPClient({
                transport: {
                    type: "http",
                    url: mcpUrl,
                    fetch: boundFetch,
                    ...(token && { headers: { Authorization: `Bearer ${token}` } }),
                },
            });
        })();
        const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
                () =>
                    reject(
                        new Error(
                            `MCP client startup timed out after ${STARTUP_TIMEOUT_MS}ms`,
                        ),
                    ),
                STARTUP_TIMEOUT_MS,
            );
        });
        mcpClientPromise = Promise.race([startup, timeout])
            .finally(() => {
                if (timeoutId !== undefined) clearTimeout(timeoutId);
            })
            .catch((err) => {
                mcpClientPromise = undefined;
                throw err;
            });
    }
    return mcpClientPromise;
}
