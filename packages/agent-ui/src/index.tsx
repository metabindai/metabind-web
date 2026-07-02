"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { MetabindAgentTransport } from "@metabindai/agent-ai-sdk/assistant-ui";
import { Thread } from "./assistant-ui/thread";
import { McpUiProvider } from "./mcp-ui-context";
import { TooltipProvider } from "./ui/tooltip";
import { makeAgentClient } from "./agent";
import { getChatConfig } from "./config";
import { noopTracer } from "./tracer";
import { WelcomeReadyProvider } from "./welcome-gate";
import {
    KICKOFF_SENTINEL,
    getSystemContext,
    setSystemContext,
} from "./context";
import { parseInit, postReady, type ChatInitDetail } from "./protocol";

// Seed the conversation from the INIT handshake (host → chat) — or, when the
// chat is served standalone, from the mount-time fallback context. `systemContext`
// is applied live every time (the transport reads it per turn); a visible
// firstPrompt / hidden kickoff opens the thread exactly once. A firstPrompt that
// arrives *after* the conversation is already underway is treated as a
// suggestion: it's dropped into the composer as a draft rather than auto-sent,
// so the host can't hijack a turn the user is in the middle of.
function useInitSeed(runtime: ReturnType<typeof useChatRuntime>): {
    welcomeReady: boolean;
} {
    const seeded = useRef(false);
    // Hold the empty-state welcome back until seeding has resolved — i.e. until
    // we've either seeded the thread or confirmed nothing will. Starts `false`
    // so a preset/embedded chat doesn't flash the welcome before the seeded
    // message arrives; an idle, unseeded thread flips it `true` to reveal it.
    const [welcomeReady, setWelcomeReady] = useState(false);
    // Last firstPrompt we acted on, so a re-delivered INIT (StrictMode's
    // setup→cleanup→setup, or a host echo) doesn't re-draft the same text.
    const lastFirstPrompt = useRef<string | null>(null);
    // Announce readiness once per page load. The ref survives StrictMode's
    // dev-only setup→cleanup→setup cycle, so the host isn't sent a duplicate
    // READY (which would echo back a duplicate INIT). A real iframe reload is a
    // fresh page, so this resets and re-announces.
    const readyPosted = useRef(false);
    const apply = useCallback(
        (ctx: ChatInitDetail) => {
            setSystemContext(ctx.systemContext);
            const cfg = getChatConfig();
            if (ctx.firstPrompt) {
                // Ignore a re-delivery of the same prompt (dev double-mount /
                // host echo); only genuinely new text should reach the UI.
                if (ctx.firstPrompt === lastFirstPrompt.current) return;
                lastFirstPrompt.current = ctx.firstPrompt;
                const { isRunning, messages } = runtime.thread.getState();
                if (seeded.current || isRunning || messages.length > 0) {
                    // A conversation is already going — don't auto-submit over
                    // it. Stage the prompt in the composer for the user to send,
                    // appending (not clobbering) anything they've already typed.
                    const composer = runtime.thread.composer;
                    const existing = composer.getState().text;
                    composer.setText(
                        existing ? `${existing} ${ctx.firstPrompt}` : ctx.firstPrompt,
                    );
                    // Thread already has content; the welcome isn't showing, but
                    // mark resolved so the gate never holds it back later.
                    setWelcomeReady(true);
                } else {
                    // Fresh thread: this is the opening message — send it.
                    seeded.current = true;
                    void runtime.thread.append(ctx.firstPrompt);
                }
                return;
            }
            if (seeded.current) return;
            if (ctx.kickoff) {
                // Hidden opener the host supplied.
                seeded.current = true;
                void runtime.thread.append(KICKOFF_SENTINEL + ctx.kickoff);
            } else if (cfg.autoStart) {
                // Nothing seeded — open the conversation anyway so we never land
                // on the empty/welcome state. Hidden, content-light opener; the
                // agent's own system prompt drives the actual greeting.
                seeded.current = true;
                void runtime.thread.append(KICKOFF_SENTINEL + cfg.autoStartMessage);
            } else {
                // Nothing to seed and autoStart is off — the thread is genuinely
                // empty, so reveal the welcome hero. The seeding paths above
                // deliberately leave the gate closed: their appended message
                // flips `isEmpty` instead, which avoids a welcome flash.
                setWelcomeReady(true);
            }
        },
        [runtime],
    );

    useEffect(() => {
        const cfg = getChatConfig();
        if (cfg.context) apply(cfg.context);
        const expected = cfg.origin ?? window.location.origin;
        const onMsg = (e: MessageEvent) => {
            if (expected && e.origin !== expected) return;
            const ctx = parseInit(e.data);
            if (ctx) apply(ctx);
        };
        window.addEventListener("message", onMsg);
        // We're now listening — tell the host to send our INIT context. This
        // avoids the load-before-listen race (the host can't know when our
        // React listener is ready, so we announce it).
        let revealTimer: ReturnType<typeof setTimeout> | undefined;
        if (window.parent && window.parent !== window) {
            if (!readyPosted.current) {
                readyPosted.current = true;
                postReady(window.parent, expected);
            }
            // The welcome stays gated until INIT arrives so it can't flash ahead
            // of a preset message. If a misbehaving host never answers, reveal it
            // anyway after a short grace period rather than sitting blank.
            revealTimer = setTimeout(() => setWelcomeReady(true), 2500);
        } else if (!cfg.context) {
            // Standalone (not embedded in the shell): no INIT will arrive, so
            // seed with defaults now — this is what triggers autoStart.
            apply({});
        }
        return () => {
            window.removeEventListener("message", onMsg);
            if (revealTimer) clearTimeout(revealTimer);
        };
    }, [apply]);

    return { welcomeReady };
}

/**
 * `children` are rendered inside the assistant-ui + MCP providers, before the
 * thread — a seam for headless host-integration helpers that need runtime
 * context (e.g. reporting conversation activity up to an embedding host, or
 * filling the composer from a host signal). They render nothing themselves.
 */
export function AgentChat({ children }: { children?: ReactNode }) {
    const runtimeRef = useRef<unknown>(null);
    const tracer = getChatConfig().tracer ?? noopTracer;

    const transport = useMemo(
        () =>
            new MetabindAgentTransport({
                client: makeAgentClient(),
                // Live getter: the hidden steering text resolves per turn.
                leadingContext: getSystemContext,
                onSendMessage: (i) => tracer.onSend(i),
                onToolCalled: (i) => tracer.onTool(i),
                onTurnUsage: (i) => tracer.onUsage(i, runtimeRef.current),
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    const runtime = useChatRuntime({ transport });
    runtimeRef.current = runtime;

    const { welcomeReady } = useInitSeed(runtime);

    return (
        <TooltipProvider>
            <AssistantRuntimeProvider runtime={runtime}>
                {children}
                <McpUiProvider>
                    <WelcomeReadyProvider value={welcomeReady}>
                        <div className="flex h-screen flex-col bg-background">
                            <Thread />
                        </div>
                    </WelcomeReadyProvider>
                </McpUiProvider>
            </AssistantRuntimeProvider>
        </TooltipProvider>
    );
}
