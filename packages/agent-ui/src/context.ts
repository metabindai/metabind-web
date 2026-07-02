// Conversation context, received from a host shell via the INIT handshake (or
// the mount-time fallback config).
//
// `systemContext` is held in a live module variable so the transport's
// `leadingContext` getter resolves the latest value on every turn.

// A hidden "kickoff" message makes the assistant speak first: it's appended as
// a user turn (so the model responds) but prefixed with this zero-width marker
// so the thread UI hides the bubble — the user sees only the assistant's intro.
export const KICKOFF_SENTINEL = "⁣⁣";

let systemContext: string | undefined;

export function setSystemContext(value: string | undefined): void {
    systemContext = value;
}

export function getSystemContext(): string | undefined {
    return systemContext;
}
