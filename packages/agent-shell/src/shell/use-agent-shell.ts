// `useAgentShell` — the ergonomic way to drive the shell.
//
// It owns the open/launch/close state and the launch element ref, and taps the
// iframe bridge so you don't wire `parseReady` / `parseDockSignal` /
// `addEventListener` by hand. Every signal that crosses the boundary — both
// directions — is reported through one `onSignal` callback. Spread the returned
// `shellProps` onto `<AgentShell>`:
//
//   const chat = useAgentShell({ chatUrl: "/chat", context, onSignal: log });
//   <button ref={chat.launchRef} onClick={chat.launch}>Ask the assistant</button>
//   <AgentShell {...chat.shellProps} />
//
// The shell still owns the actual handshake (it answers READY with INIT and
// re-presents on DOCK); this hook observes that traffic and exposes control.

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from "react";
import {
    parseDockSignal,
    parseReady,
    type DockMode,
    type DockSignalDetail,
    type ChatInitDetail,
} from "@metabindai/agent-ui/protocol";
import type { AgentShellProps } from "./AgentShell";

/** A signal crossing the iframe bridge. `dir` is relative to the host: `in` =
 *  chat → host, `out` = host → chat. */
export type AgentShellSignal =
    | { dir: "out"; kind: "open" }
    | { dir: "in"; kind: "ready" }
    | { dir: "out"; kind: "init"; context?: ChatInitDetail }
    | { dir: "in"; kind: "dock"; mode?: DockMode; payload?: unknown }
    | { dir: "out"; kind: "close" };

export type UseAgentShellOptions = {
    /** Route the chat is served at — becomes the iframe src. */
    chatUrl: string;
    /** Conversation context seeded into the chat via the INIT handshake. */
    context?: ChatInitDetail;
    /** Expected postMessage origin for the bridge. Default: window origin. */
    origin?: string;
    /** Initial dock mode. Default "modal". */
    defaultMode?: DockMode;
    /** Called for every bridge signal, both directions. */
    onSignal?: (signal: AgentShellSignal) => void;
};

export type UseAgentShell<E extends HTMLElement = HTMLButtonElement> = {
    /** Whether the shell is mounted/open. */
    open: boolean;
    /** Open the assistant. */
    launch: () => void;
    /** Close the assistant and end the session. */
    close: () => void;
    /** Attach to the element the panel should grow out of when opening. */
    launchRef: RefObject<E>;
    /** Spread onto `<AgentShell>`. */
    shellProps: Pick<
        AgentShellProps,
        | "open"
        | "chatUrl"
        | "context"
        | "origin"
        | "defaultMode"
        | "launchRef"
        | "onClose"
        | "onDock"
    >;
};

export function useAgentShell<E extends HTMLElement = HTMLButtonElement>(
    options: UseAgentShellOptions,
): UseAgentShell<E> {
    const { chatUrl, context, origin, defaultMode, onSignal } = options;
    const [open, setOpen] = useState(false);
    const launchRef = useRef<E>(null);

    // The bridge listener mounts once; read the latest callback + context
    // through refs so it always reports current values.
    const onSignalRef = useRef(onSignal);
    onSignalRef.current = onSignal;
    const contextRef = useRef(context);
    contextRef.current = context;

    const emit = useCallback((s: AgentShellSignal) => {
        onSignalRef.current?.(s);
    }, []);

    const launch = useCallback(() => {
        setOpen(true);
        emit({ dir: "out", kind: "open" });
    }, [emit]);

    const close = useCallback(() => {
        setOpen(false);
        emit({ dir: "out", kind: "close" });
    }, [emit]);

    // Tap the bridge for inbound signals (READY, DOCK). The shell listens too —
    // observing here doesn't interfere.
    useEffect(() => {
        const expected =
            origin ??
            (typeof window !== "undefined" ? window.location.origin : "");
        const onMessage = (e: MessageEvent) => {
            if (expected && e.origin !== expected) return;
            if (parseReady(e.data)) {
                emit({ dir: "in", kind: "ready" });
                // The shell answers READY with INIT — surface that outbound seed.
                emit({ dir: "out", kind: "init", context: contextRef.current });
                return;
            }
            const dock = parseDockSignal(e.data);
            if (dock) {
                emit({ dir: "in", kind: "dock", mode: dock.mode, payload: dock.payload });
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [emit, origin]);

    const onDock = useCallback(
        (detail: DockSignalDetail) =>
            emit({ dir: "in", kind: "dock", mode: detail.mode, payload: detail.payload }),
        [emit],
    );

    return {
        open,
        launch,
        close,
        launchRef,
        shellProps: {
            open,
            chatUrl,
            context,
            origin,
            defaultMode,
            launchRef,
            onClose: close,
            onDock,
        },
    };
}
