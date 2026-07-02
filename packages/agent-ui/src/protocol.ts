// The iframe bridge contract — the wire protocol shared by the chat (this
// package) and any host presentation shell that embeds it.
//
// The chat can run standalone (a normal page/route) or inside a same-origin
// iframe within a host "shell" (modal/sidebar/pill). When embedded, two kinds
// of message cross the boundary, both defined here so the chat side and the
// host side share one source of truth:
//
//   1. INIT handshake — host → chat. On load the shell seeds conversation
//      context (hidden system steering, a first visible prompt, a kickoff).
//   2. DOCK signal    — chat → host. A tool UI asks the shell to re-present the
//      chat (modal/sidebar/pill) and optionally hands back an opaque payload
//      the host can use to sync its own view (e.g. a search it ran).
//
// Plus a READY announcement (chat → host) so the host knows when the chat's
// listener is mounted and INIT won't be dropped.
//
// This lives in `@metabindai/agent-ui` (the chat) rather than the host shell so
// the reusable chat has no dependency on any particular host. A host shell
// imports the contract from `@metabindai/agent-ui/protocol`. Every reader
// validates the message origin AND a marker field, so unrelated postMessage
// traffic on the shared window is ignored.

import { useEffect } from "react";

/** modal = centered overlay, sidebar = docked right rail, pill = minimized. */
export type DockMode = "modal" | "sidebar" | "pill";

const DOCK_MARKER = "__mbDock" as const;
const INIT_MARKER = "__mbInit" as const;
const READY_MARKER = "__mbReady" as const;

// ── Dock signal (chat → host) ───────────────────────────────────────────────

export type DockSignal = {
    [DOCK_MARKER]: true;
    mode?: DockMode;
    /** Opaque payload the tool UI attached (e.g. the search it ran). The host
     *  owns its meaning — this package neither reads nor validates it. */
    payload?: unknown;
};

/** Decoded dock signal handed to the host. */
export type DockSignalDetail = {
    mode?: DockMode;
    payload?: unknown;
};

const DOCK_MODES: ReadonlySet<string> = new Set<DockMode>([
    "modal",
    "sidebar",
    "pill",
]);

function asDockMode(v: unknown): DockMode | undefined {
    return typeof v === "string" && DOCK_MODES.has(v)
        ? (v as DockMode)
        : undefined;
}

/** Chat side: post a dock signal up to the host window (e.g. the iframe parent). */
export function postDockSignal(
    target: Window,
    detail: DockSignalDetail,
    targetOrigin: string,
): void {
    const msg: DockSignal = {
        [DOCK_MARKER]: true,
        mode: detail.mode,
        payload: detail.payload ?? null,
    };
    target.postMessage(msg, targetOrigin);
}

/** Host side: validate a message and extract a dock signal, or null. */
export function parseDockSignal(data: unknown): DockSignalDetail | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    if (d[DOCK_MARKER] !== true) return null;
    return {
        mode: asDockMode(d.mode),
        payload: d.payload ?? null,
    };
}

/**
 * Host hook: listen for dock signals from the embedded chat. Only messages
 * whose `event.origin` matches `origin` (default: this window's origin) and
 * that carry the dock marker are delivered. Wire the callback to your shell's
 * mode + view state.
 */
export function useDockSignal(
    onSignal: (detail: DockSignalDetail) => void,
    options?: { origin?: string },
): void {
    useEffect(() => {
        const expected =
            options?.origin ??
            (typeof window !== "undefined" ? window.location.origin : "");
        const handler = (e: MessageEvent) => {
            if (expected && e.origin !== expected) return;
            const detail = parseDockSignal(e.data);
            if (detail) onSignal(detail);
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, [onSignal, options?.origin]);
}

// ── Init handshake (host → chat) ─────────────────────────────────────────────

export type ChatInit = {
    [INIT_MARKER]: true;
    /** Hidden steering text injected as a leading message every turn. */
    systemContext?: string;
    /** Visible first user message, seeded once. */
    firstPrompt?: string;
    /** Hidden instruction that makes the assistant open the conversation. */
    kickoff?: string;
    /** Title shown in the shell chrome (echoed for convenience). */
    title?: string;
};

/** Decoded init payload (marker stripped). */
export type ChatInitDetail = Omit<ChatInit, typeof INIT_MARKER>;

/** Host side: post the init handshake into the chat iframe. */
export function postInit(
    target: Window,
    detail: ChatInitDetail,
    targetOrigin: string,
): void {
    const msg: ChatInit = { [INIT_MARKER]: true, ...detail };
    target.postMessage(msg, targetOrigin);
}

/** Chat side: validate a message and extract the init payload, or null. */
export function parseInit(data: unknown): ChatInitDetail | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    if (d[INIT_MARKER] !== true) return null;
    const { [INIT_MARKER]: _marker, ...rest } = d;
    return rest as ChatInitDetail;
}

// ── Ready handshake (chat → host) ────────────────────────────────────────────
//
// The host can't reliably post INIT on the iframe's `load` event: the chat's
// React app — and its message listener — usually mounts *after* `load` fires,
// so an INIT sent then is dropped. Instead the chat announces readiness once it
// is listening; the host replies with INIT. This makes ordering deterministic.

export type ChatReady = { [READY_MARKER]: true };

/** Chat side: tell the host the chat is mounted and listening for INIT. */
export function postReady(target: Window, targetOrigin: string): void {
    const msg: ChatReady = { [READY_MARKER]: true };
    target.postMessage(msg, targetOrigin);
}

/** Host side: is this message the chat's readiness announcement? */
export function parseReady(data: unknown): boolean {
    return (
        !!data &&
        typeof data === "object" &&
        (data as Record<string, unknown>)[READY_MARKER] === true
    );
}
