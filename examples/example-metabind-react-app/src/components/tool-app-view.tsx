"use client";

import { AppRenderer } from "@mcp-ui/client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useAui } from "@assistant-ui/react";
import { useEffect, useMemo, useState } from "react";
import { callMCPTool, getMCPClient } from "@/mcp";

// Flatten an MCP UI message (as sent by an iframe via ui/message) into a single
// string for the composer input. Non-text blocks become `[type]` placeholders
// so the user still sees something representable when they review the draft.
function toComposerText(
    blocks: ReadonlyArray<{ type: string; text?: string }>,
): string {
    const parts: string[] = [];
    for (const b of blocks ?? []) {
        if (b.type === "text" && typeof b.text === "string") {
            parts.push(b.text);
        } else {
            parts.push(`[${b.type}]`);
        }
    }
    return parts.join("\n\n");
}

export function ToolAppView({
    toolName,
    resourceUri,
    toolInput,
    toolResult,
}: {
    toolName: string;
    resourceUri: string;
    toolInput?: Record<string, unknown>;
    toolResult?: CallToolResult;
}) {
    const aui = useAui();
    const [html, setHtml] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                console.log("[tool-app-view] readResource", { toolName, resourceUri });
                const client = await getMCPClient();
                const data = await client.readResource({ uri: resourceUri });
                console.log("[tool-app-view] resource data", data);
                if (cancelled) return;
                const c = (data as { contents?: Array<{ text?: string }> })?.contents?.[0];
                if (typeof c?.text === "string") setHtml(c.text);
                else setError(`no html in resource ${resourceUri}`);
            } catch (err) {
                console.error("[tool-app-view] readResource failed", { toolName, resourceUri, err });
                if (!cancelled) setError(String(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [resourceUri, toolName]);

    const sandboxUrl = useMemo(
        () =>
            typeof window === "undefined"
                ? null
                : new URL(
                      `${import.meta.env.BASE_URL}sandbox_proxy.html`,
                      window.location.origin,
                  ),
        [],
    );

    if (error) return <div className="text-xs text-destructive">{error}</div>;
    if (!html || !sandboxUrl)
        return <div className="text-xs text-muted-foreground">loading ui…</div>;

    return (
        <div className="rounded-md overflow-hidden bg-background min-h-[50px] [&>div]:min-h-[50px]">
            <AppRenderer
                toolName={toolName}
                sandbox={{ url: sandboxUrl }}
                html={html}
                toolInput={toolInput}
                toolResult={toolResult}
                onOpenLink={async ({ url }) => {
                    if (url.startsWith("https://") || url.startsWith("http://")) {
                        window.open(url, "_blank", "noopener,noreferrer");
                    }
                    return { isError: false };
                }}
                onCallTool={async (params) => {
                    console.log("[ui tools/call]", params);
                    try {
                        const result = await callMCPTool(
                            params.name,
                            params.arguments as Record<string, unknown> | undefined,
                        );
                        return result;
                    } catch (err) {
                        console.error("[ui tools/call] failed", err);
                        return {
                            isError: true,
                            content: [{ type: "text", text: String(err) }],
                        } satisfies CallToolResult;
                    }
                }}
                onMessage={async (params) => {
                    console.log("[ui message]", params);
                    try {
                        const blocks = (params?.content ?? []) as ReadonlyArray<{
                            type: string;
                            text?: string;
                        }>;
                        const text = toComposerText(blocks);
                        if (text.length > 0) {
                            aui.thread().composer().setText(text);
                        }
                        return { isError: false };
                    } catch (err) {
                        console.error("[ui message] failed", err);
                        return { isError: true };
                    }
                }}
                onFallbackRequest={async (req) => {
                    console.warn("[ui fallback]", req.method, req.params);
                    throw new Error(`No handler for method: ${req.method}`);
                }}
                onError={(err) => console.error("[ui error]", err)}
            />
        </div>
    );
}
