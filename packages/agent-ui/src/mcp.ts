import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getChatConfig, resolveApiKey } from "./config";

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

// UI resources are large (the metabind render bundles are ~1 MB of inlined
// HTML/JS) and immutable per version, so reading one is memoized per URI for
// the page session. This dedupes the dev-mode StrictMode double-mount (two 1 MB
// fetches), any surface remount, and repeat renders of the same tool — and lets
// a surface's HTML be prefetched (warmed into this cache) before it mounts.
const resourceHtmlCache = new Map<string, Promise<string>>();

export function readResourceHtml(uri: string): Promise<string> {
    let p = resourceHtmlCache.get(uri);
    if (!p) {
        p = (async () => {
            const client = await getMCPClient();
            const data = await client.readResource({ uri });
            const c = (data as { contents?: Array<{ text?: string }> })
                ?.contents?.[0];
            if (typeof c?.text !== "string")
                throw new Error(`no html in resource ${uri}`);
            return c.text;
        })().catch((err) => {
            // Drop the rejected promise so a later mount can retry.
            resourceHtmlCache.delete(uri);
            throw err;
        });
        resourceHtmlCache.set(uri, p);
    }
    return p;
}

/** Fire-and-forget warm of a UI resource into the cache. Safe to call before
 *  the surface mounts (e.g. as soon as a seeded tool's URI is known) so the
 *  ~1 MB fetch overlaps the rest of startup instead of gating the render. */
export function prefetchResourceHtml(uri: string): void {
    void readResourceHtml(uri).catch(() => {
        /* the mount will surface the error */
    });
}

export async function getMCPClient(): Promise<MCPClient> {
    if (!mcpClientPromise) {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const startup = (async () => {
            const { mcpUrl } = getChatConfig();
            // The HTTP transport defaults to `globalThis.fetch`, which throws
            // "Can only call Window.fetch on instances of Window" in browsers
            // because the unbound reference loses its receiver. Also: the
            // transport adds a User-Agent suffix header that triggers a CORS
            // preflight the metabind MCP server doesn't whitelist. Strip it.
            //
            // The Authorization header is resolved and injected here (per
            // request) rather than once at transport construction, so a config
            // whose `apiKey` is a getter — e.g. a host-brokered OAuth token that
            // is refreshed on expiry — is picked up even though the client is a
            // module singleton. An async getter also lets the first tools/list
            // wait until the token is available (bounded by STARTUP_TIMEOUT_MS)
            // instead of firing unauthenticated and 401ing.
            const boundFetch: typeof fetch = async (input, init) => {
                const h = new Headers(init?.headers);
                h.delete("user-agent");
                const token = await resolveApiKey();
                if (token) h.set("Authorization", `Bearer ${token}`);
                return window.fetch(input, { ...init, headers: h });
            };
            return await createMCPClient({
                transport: {
                    type: "http",
                    url: mcpUrl,
                    fetch: boundFetch,
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
