"use client";

import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { getMCPClient } from "./mcp";

type IconSpec = { src: string; mimeType?: string; sizes?: string[] };

type McpTool = {
    name: string;
    title?: string;
    description?: string;
    icons?: IconSpec[] | null;
    _meta?: unknown;
};

type McpServerInfo = {
    name?: string;
    title?: string;
    version?: string;
    icons?: IconSpec[] | null;
};

type ToolsPayload =
    | { url: string; tools: McpTool[]; serverInfo?: McpServerInfo }
    | { url: string; error: string };

type McpUiContextValue = {
    uiResourceByTool: Map<string, string>;
    iconByTool: Map<string, string>;
    fallbackIcon: string;
    debug: boolean;
};

const FALLBACK_ICON_URL =
    "https://metabind.ai/metabind-favicon-192x192.png";

// Module-level mirror of the connected MCP server's name. The analytics
// callback in app.tsx fires from the transport's response stream (outside
// the React tree) where `useMcpUi` isn't accessible, so we copy the value
// here once the provider resolves it.
let currentMcpServerName: string | undefined;
export function getMcpServerName(): string | undefined {
    return currentMcpServerName;
}

const McpUiContext = createContext<McpUiContextValue>({
    uiResourceByTool: new Map(),
    iconByTool: new Map(),
    fallbackIcon: FALLBACK_ICON_URL,
    debug: false,
});

function extractUiResourceUri(meta: unknown): string | undefined {
    if (!meta || typeof meta !== "object") return undefined;
    const m = meta as Record<string, unknown>;
    const flat = m["ui/resourceUri"];
    if (typeof flat === "string") return flat;
    const nested = m.ui;
    if (nested && typeof nested === "object") {
        const u = (nested as Record<string, unknown>).resourceUri;
        if (typeof u === "string") return u;
    }
    return undefined;
}

export function McpUiProvider({ children }: { children: ReactNode }) {
    const [info, setInfo] = useState<ToolsPayload | null>(null);
    const [debug, setDebug] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const v = new URLSearchParams(window.location.search).get("debug");
            setDebug(v === "1" || v === "true");
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
        let attempt = 0;
        const tryLoad = async () => {
            try {
                const client = await getMCPClient();
                const { tools } = await client.listTools();
                console.log("[mcp-ui] listTools tools:", tools);
                console.log("[mcp-ui] serverInfo:", client.serverInfo);
                if (cancelled) return;
                const serverInfo = client.serverInfo as
                    | McpServerInfo
                    | undefined;
                currentMcpServerName = serverInfo?.name;
                setInfo({
                    url: "",
                    tools: tools as McpTool[],
                    serverInfo,
                });
            } catch (err) {
                console.error(
                    `[mcp-ui] listTools failed (attempt ${attempt + 1}):`,
                    err,
                );
                if (cancelled) return;
                if (attempt < RETRY_DELAYS_MS.length) {
                    const delay = RETRY_DELAYS_MS[attempt];
                    attempt++;
                    retryTimer = setTimeout(tryLoad, delay);
                    return;
                }
                setInfo({
                    url: "",
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        };
        tryLoad();
        return () => {
            cancelled = true;
            if (retryTimer !== undefined) clearTimeout(retryTimer);
        };
    }, []);

    const value = useMemo<McpUiContextValue>(() => {
        const uiResourceByTool = new Map<string, string>();
        const iconByTool = new Map<string, string>();
        if (info && "tools" in info) {
            const serverIcon = info.serverInfo?.icons?.[0]?.src;
            for (const t of info.tools) {
                const uri = extractUiResourceUri(t._meta);
                console.log("[mcp-ui] extract", t.name, "_meta=", t._meta, "→ uri=", uri);
                if (uri) uiResourceByTool.set(t.name, uri);
                const src = t.icons?.[0]?.src ?? serverIcon;
                if (src) iconByTool.set(t.name, src);
            }
            console.log("[mcp-ui] uiResourceByTool map:", Array.from(uiResourceByTool.entries()));
        }
        return {
            uiResourceByTool,
            iconByTool,
            fallbackIcon: FALLBACK_ICON_URL,
            debug,
        };
    }, [info, debug]);

    return (
        <McpUiContext.Provider value={value}>{children}</McpUiContext.Provider>
    );
}

export function useMcpUi() {
    return useContext(McpUiContext);
}
