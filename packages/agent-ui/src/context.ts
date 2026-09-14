// Conversation context, received from a host shell via the INIT handshake (or
// the mount-time fallback config).
//
// `systemContext` is held in a live module variable so the transport's
// `leadingContext` getter resolves the latest value on every turn.

// A hidden "kickoff" message makes the assistant speak first: it's appended as
// a user turn (so the model responds) but prefixed with this zero-width marker
// so the thread UI hides the bubble — the user sees only the assistant's intro.
export const KICKOFF_SENTINEL = "⁣⁣";

// A host-supplied `greeting` (a pre-baked assistant opener) is seeded as a
// hidden user turn + the visible assistant message, so the thread opens in the
// assistant's voice while staying well-formed for the agent (a leading user
// turn, never a bare assistant one). This is that hidden user turn's content:
// sentinel-prefixed so the UI hides its bubble; the model only ever sees it as
// prior context on later turns.
export const GREETING_LEAD_IN =
    KICKOFF_SENTINEL + "The user just opened the assistant.";

let systemContext: string | undefined;

export function setSystemContext(value: string | undefined): void {
    systemContext = value;
}

export function getSystemContext(): string | undefined {
    return systemContext;
}
