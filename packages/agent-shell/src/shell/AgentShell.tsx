import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type FC,
} from "react";
import {
    XIcon,
    SparklesIcon,
    Maximize2Icon,
    PanelRightIcon,
    MinusIcon,
} from "lucide-react";
import {
    type DockMode,
    type DockSignalDetail,
    type ChatInitDetail,
    parseReady,
    postInit,
    useDockSignal,
} from "@metabindai/agent-ui/protocol";
import {
    type Geom,
    dockPillGeom,
    geomForMode,
    modalGeom,
    rectToGeom,
} from "./geometry";

const HEADER_H = 52;
const DEFAULT_TITLE = "Assistant";
const ACCENT = "#1a1a1a";

const ICON_BTN: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 9999,
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(0,0,0,0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: "#1a1a1a",
};

export type AgentShellProps = {
    /** Route the consumer serves the chat entry at — becomes the iframe src. */
    chatUrl: string;
    /** Mounts the dock. Toggle to false to end the session and unmount. */
    open: boolean;
    title?: string;
    /** Controlled mode. Omit to let the shell manage it (uncontrolled). */
    mode?: DockMode;
    /** Initial mode when uncontrolled. Default "modal". */
    defaultMode?: DockMode;
    /** Notified on every mode change (tool-driven or user-driven). */
    onModeChange?: (mode: DockMode) => void;
    /** A tool UI in the chat asked to dock and handed back an opaque payload
     *  (the bridge doesn't interpret it). Use it to sync your own view. */
    onDock?: (detail: DockSignalDetail) => void;
    /** Grow-from-element origin (a precomputed rect) for the open animation.
     *  Takes precedence over `launchRef`. Omit both to grow from the resting
     *  pill position. */
    launchFrom?: Geom | null;
    /** Element to grow the panel out of when opening — its bounding rect is
     *  measured at open time. The ergonomic alternative to `launchFrom`: pass
     *  the launch button's ref and the shell handles the geometry. */
    launchRef?: { current: HTMLElement | null };
    /** Conversation context seeded into the chat via the INIT handshake. */
    context?: ChatInitDetail;
    /** Ends the session (close button / pill close). */
    onClose?: () => void;
    /** Bump to remount the iframe and reseed the conversation. */
    reloadKey?: number;
    /** Expected postMessage origin for the bridge. Default: window origin. */
    origin?: string;
};

// A single persistent panel that hosts the chat iframe and morphs between a
// centered modal, a docked right sidebar, and a floating bottom-right pill. The
// iframe is never unmounted while open, so the chat session survives mode
// changes. The shell owns the iframe bridge: it seeds context on load (INIT)
// and re-surfaces tool dock signals as `onModeChange` / `onDock`.
export const AgentShell: FC<AgentShellProps> = ({
    chatUrl,
    open,
    title: titleProp,
    mode: controlledMode,
    defaultMode = "modal",
    onModeChange,
    onDock,
    launchFrom,
    launchRef,
    context,
    onClose,
    reloadKey = 0,
    origin,
}) => {
    // The header title: an explicit `title` prop wins, then the seeded
    // `context.title`, then the default. (context.title is also echoed into the
    // chat via INIT.)
    const title = titleProp ?? context?.title ?? DEFAULT_TITLE;
    const [uncontrolledMode, setUncontrolledMode] =
        useState<DockMode>(defaultMode);
    const mode = controlledMode ?? uncontrolledMode;
    const setMode = useCallback(
        (next: DockMode) => {
            if (controlledMode === undefined) setUncontrolledMode(next);
            onModeChange?.(next);
        },
        [controlledMode, onModeChange],
    );

    // `ready` drives the open animation: the panel paints at the collapsed
    // launch origin, then flips to the mode geometry one frame later so it
    // visibly grows. It must RESET each time `open` goes false→true — the shell
    // stays mounted across sessions, so a once-on-mount flag would skip the
    // grow on every open after the first.
    const [ready, setReady] = useState(false);
    const [, force] = useState(0);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        if (!open) {
            setReady(false);
            return;
        }
        // First paint stays at the collapsed launch origin (ready is already
        // false from the closed state), then flips one frame later so the panel
        // visibly grows out of it.
        setReady(false);
        const r = requestAnimationFrame(() =>
            requestAnimationFrame(() => setReady(true)),
        );
        return () => cancelAnimationFrame(r);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    useEffect(() => {
        const on = () => force((n) => n + 1);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    useEffect(() => {
        if (mode !== "modal") return;
        const onKey = (e: KeyboardEvent) =>
            e.key === "Escape" && setMode("pill");
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [mode, setMode]);

    // Tool signals from the embedded chat: dock/minimize + surface the payload.
    useDockSignal(
        useCallback(
            (detail) => {
                if (detail.mode) setMode(detail.mode);
                onDock?.(detail);
            },
            [setMode, onDock],
        ),
        { origin },
    );

    // Seed conversation context into the chat. The chat posts READY once its
    // listener is live; we reply with INIT to the announcing window. (Posting on
    // iframe `load` would race the chat's not-yet-mounted listener.)
    useEffect(() => {
        if (!open) return;
        const expected =
            origin ??
            (typeof window !== "undefined" ? window.location.origin : "");
        const onMsg = (e: MessageEvent) => {
            if (expected && e.origin !== expected) return;
            if (!parseReady(e.data) || !context || !e.source) return;
            postInit(e.source as Window, context, expected || "*");
        };
        window.addEventListener("message", onMsg);
        return () => window.removeEventListener("message", onMsg);
    }, [open, context, origin]);

    const mg = modalGeom();
    // The launch origin the panel grows out of: an explicit rect, a measured
    // element, or the resting pill. Only used while !ready (the open moment).
    const collapsed =
        launchFrom ??
        (launchRef?.current
            ? rectToGeom(launchRef.current.getBoundingClientRect())
            : dockPillGeom());
    const geom = ready ? geomForMode(mode) : collapsed;

    const isPill = mode === "pill";
    const showChrome = mode !== "pill";
    const showBackdrop = mode === "modal";

    const ease = "cubic-bezier(0.22,1,0.36,1)";
    const geomTransition = ["left", "top", "width", "height"]
        .map((p) => `${p} 380ms ${ease}`)
        .concat([
            "border-radius 380ms ease",
            "background-color 300ms ease",
            "box-shadow 300ms ease",
        ])
        .join(", ");

    if (!open) return null;

    return (
        <>
            <div
                onClick={() => setMode("pill")}
                style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 1900,
                    background: "rgba(18,20,22,0.55)",
                    backdropFilter: "blur(4px)",
                    WebkitBackdropFilter: "blur(4px)",
                    opacity: showBackdrop ? 1 : 0,
                    pointerEvents: showBackdrop ? "auto" : "none",
                    transition: "opacity 260ms ease",
                }}
            />
            <div
                onClick={isPill ? () => setMode("modal") : undefined}
                style={{
                    position: "fixed",
                    zIndex: 2000,
                    left: geom.left,
                    top: geom.top,
                    width: geom.width,
                    height: geom.height,
                    borderRadius: geom.radius,
                    overflow: "hidden",
                    background: isPill ? "#23282e" : "#fff",
                    boxShadow: isPill
                        ? "0 12px 30px rgba(0,0,0,0.28)"
                        : "0 24px 70px rgba(0,0,0,0.32)",
                    cursor: isPill ? "pointer" : "default",
                    transition: geomTransition,
                }}
            >
                {/* Header bar: title (left) + window controls (right). */}
                <div
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: HEADER_H,
                        zIndex: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "0 12px 0 18px",
                        background: "#fff",
                        borderBottom: "1px solid rgba(0,0,0,0.06)",
                        opacity: showChrome ? 1 : 0,
                        pointerEvents: showChrome ? "auto" : "none",
                        transition: "opacity 200ms ease 120ms",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                        }}
                    >
                        <SparklesIcon size={16} color={ACCENT} />
                        <span
                            style={{
                                fontFamily: "system-ui, sans-serif",
                                fontWeight: 600,
                                fontSize: 15,
                                color: "#1a1a1a",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {title}
                        </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        {mode === "sidebar" ? (
                            <button
                                onClick={() => setMode("modal")}
                                aria-label="Expand chat"
                                style={ICON_BTN}
                            >
                                <Maximize2Icon size={17} />
                            </button>
                        ) : (
                            <button
                                onClick={() => setMode("sidebar")}
                                aria-label="Dock chat to the side"
                                style={ICON_BTN}
                            >
                                <PanelRightIcon size={17} />
                            </button>
                        )}
                        <button
                            onClick={() => setMode("pill")}
                            aria-label="Minimize chat"
                            style={ICON_BTN}
                        >
                            <MinusIcon size={18} />
                        </button>
                        <button
                            onClick={() => onClose?.()}
                            aria-label="Close chat"
                            style={ICON_BTN}
                        >
                            <XIcon size={17} />
                        </button>
                    </div>
                </div>

                {/* Minimized pill: label (expands) + small close (ends session) */}
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "0 10px 0 18px",
                        color: "#fff",
                        fontFamily: "system-ui, sans-serif",
                        fontWeight: 500,
                        fontSize: 15,
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                        opacity: isPill ? 1 : 0,
                        transition: "opacity 200ms ease",
                    }}
                >
                    <SparklesIcon size={18} />
                    <span style={{ flex: 1 }}>Continue chat</span>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose?.();
                        }}
                        aria-label="Close chat"
                        style={{
                            pointerEvents: isPill ? "auto" : "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 26,
                            height: 26,
                            borderRadius: 9999,
                            background: "rgba(255,255,255,0.16)",
                            border: "none",
                            color: "#fff",
                            cursor: "pointer",
                        }}
                    >
                        <XIcon size={15} />
                    </button>
                </div>

                {/* Persistent chat iframe — below the header, sized to the panel
                    (minus header) and clipped so it doesn't reflow mid-morph. */}
                <iframe
                    ref={iframeRef}
                    key={reloadKey}
                    src={chatUrl}
                    title={title}
                    style={{
                        position: "absolute",
                        left: 0,
                        top: HEADER_H,
                        width: mode === "sidebar" ? geom.width : mg.width,
                        height:
                            (mode === "sidebar" ? geom.height : mg.height) -
                            HEADER_H,
                        border: "none",
                        opacity: showChrome ? 1 : 0,
                        pointerEvents: showChrome ? "auto" : "none",
                        transition: "opacity 240ms ease 140ms",
                    }}
                />
            </div>
        </>
    );
};
