"use client";

import { AppRenderer } from "@mcp-ui/client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useAui } from "@assistant-ui/react";
import { useEffect, useMemo, useState } from "react";
import { callMCPTool, getMCPClient } from "./mcp";
import { getChatConfig } from "./config";
import { postDockSignal, type DockMode } from "./protocol";

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
    // The mcp-ui iframe is created at a fixed 600px and only snaps to its real
    // height once the guest reports a size. That 600px slam (then snap) shoves
    // the thread around right before the tool renders. Track the guest-reported
    // height and clip the wrapper to it (a small skeleton until the first
    // report) so the block only ever grows once, straight to the right size.
    const [contentHeight, setContentHeight] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const client = await getMCPClient();
                const data = await client.readResource({ uri: resourceUri });
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
                : new URL(getChatConfig().sandboxUrl, window.location.origin),
        [],
    );

    if (error) return <div className="text-xs text-destructive">{error}</div>;
    if (!html || !sandboxUrl)
        return <div className="text-xs text-muted-foreground">loading ui…</div>;

    return (
        <div
            className="rounded-md overflow-hidden bg-background"
            style={{ height: contentHeight ?? 64 }}
        >
            <AppRenderer
                toolName={toolName}
                sandbox={{ url: sandboxUrl }}
                html={html}
                onSizeChanged={(p) => {
                    const h = (p as { height?: number } | undefined)?.height;
                    if (typeof h === "number" && h > 0) setContentHeight(h);
                }}
                toolInput={toolInput}
                toolResult={toolResult}
                onOpenLink={async ({ url }) => {
                    if (url.startsWith("https://") || url.startsWith("http://")) {
                        window.open(url, "_blank", "noopener,noreferrer");
                    }
                    return { isError: false };
                }}
                onCallTool={async (params) => {
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
                    try {
                        const blocks = (params?.content ?? []) as ReadonlyArray<{
                            type: string;
                            text?: string;
                        }>;
                        const text = toComposerText(blocks);
                        if (text.length > 0) {
                            const thread = aui.thread();
                            const { isRunning, isLoading, isDisabled } =
                                thread.getState();
                            if (isRunning || isLoading || isDisabled) {
                                // The assistant is mid-stream (or the thread is
                                // otherwise busy). Appending a user turn now
                                // throws and tears down the chat, so instead
                                // stage the message in the composer as a draft —
                                // appending to (not clobbering) anything already
                                // typed — and let the user send it when ready.
                                const composer = thread.composer();
                                const existing = composer.getState().text;
                                composer.setText(
                                    existing ? `${existing} ${text}` : text,
                                );
                            } else {
                                // Idle thread: auto-submit straight to the
                                // assistant as a new user turn.
                                thread.append({
                                    role: "user",
                                    content: [{ type: "text", text }],
                                });
                            }
                        }
                        return { isError: false };
                    } catch (err) {
                        console.error("[ui message] failed", err);
                        return { isError: true };
                    }
                }}
                onFallbackRequest={async (req) => {
                    // A tool UI can dock/minimize the chat so the user sees the
                    // results behind it. It sends `ui/dock` with
                    // { mode: "sidebar" | "pill" | "modal" }; we relay it up to
                    // the host shell via the typed bridge (the chat runs in an
                    // iframe within the host page).
                    if (req.method === "ui/dock") {
                        const p = req.params as
                            | { mode?: DockMode; payload?: unknown }
                            | undefined;
                        if (window.parent && window.parent !== window) {
                            postDockSignal(
                                window.parent,
                                {
                                    mode: p?.mode ?? "sidebar",
                                    // The tool UI's dock payload is opaque to the
                                    // chat — relayed verbatim for the host to
                                    // interpret.
                                    payload: p?.payload ?? null,
                                },
                                window.location.origin,
                            );
                        }
                        return { ok: true };
                    }
                    console.warn("[ui fallback]", req.method, req.params);
                    throw new Error(`No handler for method: ${req.method}`);
                }}
                onError={(err) => console.error("[ui error]", err)}
            />
        </div>
    );
}
