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
import { useChat, type UIMessage } from "@ai-sdk/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { MetabindAgentTransport } from "@metabindai/agent-ai-sdk/assistant-ui";
import { Thread } from "./assistant-ui/thread";
import { McpUiProvider, registerToolResource } from "./mcp-ui-context";
import { prefetchResourceHtml } from "./mcp";
import { TooltipProvider } from "./ui/tooltip";
import { makeAgentClient } from "./agent";
import { getChatConfig } from "./config";
import { noopTracer } from "./tracer";
import { WelcomeReadyProvider } from "./welcome-gate";
import {
    GREETING_LEAD_IN,
    KICKOFF_SENTINEL,
    getSystemContext,
    setSystemContext,
} from "./context";
import {
    parseInit,
    postReady,
    type ChatInitDetail,
    type GreetingMessage,
} from "./protocol";

// Build the AI-SDK messages for a seeded greeting: a hidden user lead-in turn
// (so the thread leads with a user turn even if `leadingContext` is empty),
// then a SINGLE assistant turn whose parts are the greeting entries in order —
// static text, and/or a static UI tool call whose surface renders from fixed
// input with no model call. Keeping them in one message (not one message per
// entry) matters for layout: every assistant message reserves ~5rem below it
// for its action bar, so splitting the greeting into multiple messages would
// stack that gap between the text and the form. One message renders the text
// immediately above its form as a single cohesive turn.
//
// These MUST be real AI-SDK UIMessages: the runtime's `thread.import` round-
// trips through the external store and silently drops messages carrying no
// AI-SDK original. Tool parts are never sent to the agent (the transport
// serializes only text), so a synthetic tool call is a pure client-side
// render — its form drives the next turn when the user interacts with it.
function buildGreetingMessages(
    greeting: string | GreetingMessage[],
): UIMessage[] {
    const entries = typeof greeting === "string" ? [greeting] : greeting;
    const parts: UIMessage["parts"] = [];
    for (const entry of entries) {
        if (typeof entry === "string") {
            parts.push({ type: "text", text: entry });
        } else if ("text" in entry) {
            parts.push({ type: "text", text: entry.text });
        } else if (entry.tool) {
            parts.push({
                // A completed tool call: `output-available` so it renders as a
                // finished surface and the runtime won't try to execute it. The
                // UI surface is resolved by tool name and driven by `input`;
                // `output` rarely matters.
                type: `tool-${entry.tool}`,
                toolCallId: crypto.randomUUID(),
                state: "output-available",
                input: entry.input ?? {},
                output: entry.output ?? { content: [] },
            } as UIMessage["parts"][number]);
        }
    }
    return [
        {
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text: GREETING_LEAD_IN }],
        },
        {
            id: crypto.randomUUID(),
            role: "assistant",
            parts,
            // Tag this seeded turn so the thread renders it compactly. A static
            // greeting can't be copied/reloaded/branched, so its action-bar
            // footer is dead chrome — and the space it reserves shows as a gap
            // when the turn is immediately followed by the user's answer.
            metadata: { custom: { seeded: true } },
        },
    ] as UIMessage[];
}

// Seed the conversation from the INIT handshake (host → chat) — or, when the
// chat is served standalone, from the mount-time fallback context. `systemContext`
// is applied live every time (the transport reads it per turn); a visible
// firstPrompt / hidden kickoff opens the thread exactly once. A pre-baked
// `greeting`, when present, is *additive*: it's injected straight into the
// AI-SDK message list as a pre-baked assistant opening turn (no model
// round-trip) so the host can greet instantly with details it already knows,
// and then the configured firstPrompt/kickoff STILL runs — so the user sees
// the greeting, then a "Thinking…" turn, then the model's first real response.
// A firstPrompt that arrives *after* the conversation is already underway is
// treated as a suggestion: it's dropped into the composer as a draft rather
// than auto-sent, so the host can't hijack a turn the user is in the middle of.
function useInitSeed(
    runtime: ReturnType<typeof useAISDKRuntime>,
    chat: ReturnType<typeof useChat>,
): {
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
    // Same guard for a seeded assistant greeting.
    const lastGreeting = useRef<string | null>(null);
    // Whether the pre-baked greeting bubble has been injected, and how many
    // messages it added. Kept separate from `seeded` (the LLM opener) so the
    // greeting can show *and* the configured firstPrompt/kickoff still runs.
    const greetingSeeded = useRef(false);
    const preSeededCount = useRef(0);
    // Announce readiness once per page load. The ref survives StrictMode's
    // dev-only setup→cleanup→setup cycle, so the host isn't sent a duplicate
    // READY (which would echo back a duplicate INIT). A real iframe reload is a
    // fresh page, so this resets and re-announces.
    const readyPosted = useRef(false);
    const apply = useCallback(
        (ctx: ChatInitDetail) => {
            setSystemContext(ctx.systemContext);
            const cfg = getChatConfig();
            if (ctx.greeting) {
                // Show the pre-baked greeting turn(s) verbatim — instant, no
                // model call — then FALL THROUGH so the configured opener
                // (firstPrompt / kickoff / autoStart) still runs. The user
                // sees the greeting, then a "Thinking…" turn, then the model's
                // first real response.
                const key = JSON.stringify(ctx.greeting);
                if (key !== lastGreeting.current) {
                    lastGreeting.current = key;
                    // Any inline tool resource URIs: register them so the
                    // surface resolves without the listTools round trip, and
                    // prefetch the (large) resource HTML right now so the fetch
                    // overlaps startup instead of gating the render.
                    const entries =
                        typeof ctx.greeting === "string" ? [] : ctx.greeting;
                    for (const e of entries) {
                        if (
                            typeof e === "object" &&
                            "tool" in e &&
                            e.tool &&
                            e.resourceUri
                        ) {
                            registerToolResource(e.tool, e.resourceUri);
                            prefetchResourceHtml(e.resourceUri);
                        }
                    }
                    const { isRunning, messages } = runtime.thread.getState();
                    // Only inject into a fresh, idle thread; mid-conversation a
                    // static opener has no place, so drop it silently. The
                    // welcome gate stays closed: the injected messages flip
                    // `isEmpty` instead, avoiding a welcome flash.
                    if (
                        !greetingSeeded.current &&
                        !isRunning &&
                        messages.length === 0
                    ) {
                        const seededMsgs = buildGreetingMessages(ctx.greeting);
                        greetingSeeded.current = true;
                        preSeededCount.current = seededMsgs.length;
                        chat.setMessages(seededMsgs);
                    }
                }
                // No return — the opener below still fires the LLM turn.
            }
            if (ctx.firstPrompt) {
                // Ignore a re-delivery of the same prompt (dev double-mount /
                // host echo); only genuinely new text should reach the UI.
                if (ctx.firstPrompt === lastFirstPrompt.current) return;
                lastFirstPrompt.current = ctx.firstPrompt;
                const { isRunning, messages } = runtime.thread.getState();
                // "Underway" ignores our own pre-seeded greeting — a thread that
                // holds only the greeting is still fresh for sending the opener.
                if (
                    seeded.current ||
                    isRunning ||
                    messages.length > preSeededCount.current
                ) {
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
            } else if (!greetingSeeded.current) {
                // Nothing to seed and autoStart is off — the thread is genuinely
                // empty, so reveal the welcome hero. The seeding paths above
                // deliberately leave the gate closed: their appended message
                // flips `isEmpty` instead, which avoids a welcome flash. (A
                // greeting-only seed already filled the thread, so skip it.)
                setWelcomeReady(true);
            }
        },
        [runtime, chat],
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
                // MET-1271: route this chat to the draft MCP server when the
                // host configured it. Fixed for the transport's lifetime —
                // switching requires a remount (fresh conversation).
                draft: getChatConfig().draft,
                // Live getter: the hidden steering text resolves per turn.
                leadingContext: getSystemContext,
                onSendMessage: (i) => tracer.onSend(i),
                onToolCalled: (i) => tracer.onTool(i),
                onTurnUsage: (i) => tracer.onUsage(i, runtimeRef.current),
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    // Own the AI-SDK `useChat` instance directly (rather than via
    // `useChatRuntime`) so seeding can inject a pre-baked assistant greeting
    // straight into the message list. `useChatRuntime` only adds the
    // remote-thread-list wrapper on top of this, which this single ephemeral
    // thread doesn't use.
    const chat = useChat({ transport });
    const runtime = useAISDKRuntime(chat);
    runtimeRef.current = runtime;

    const { welcomeReady } = useInitSeed(runtime, chat);

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
