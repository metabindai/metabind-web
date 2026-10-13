// Turns a chat error into text a person can read. A failed /chat request
// reaches the thread as the proxy's raw response body, e.g.
// `{"error":"configuration_error","message":"Agent settings not configured…","details":{…}}`
// (sometimes behind a prefix such as `metabind agent /chat 400: `). Show the
// envelope's `message`; keep `code` and `details` for developers.

export type ParsedChatError = {
    /** Human-readable text to show in the thread. */
    message: string;
    /** Machine-readable code from the envelope (`error` or `code`), if any. */
    code?: string;
    /** The envelope's `details`, if any. */
    details?: unknown;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

const nonEmpty = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;

function fromEnvelope(obj: Record<string, unknown>): ParsedChatError | undefined {
    // `{ error: { message, code|type } }` (nested provider-style envelope).
    if (isRecord(obj.error) && nonEmpty(obj.error.message)) {
        const inner = obj.error;
        const code = nonEmpty(inner.code)
            ? inner.code
            : nonEmpty(inner.type)
              ? inner.type
              : undefined;
        return { message: inner.message as string, code, details: inner.details ?? obj.details };
    }
    if (!nonEmpty(obj.message)) return undefined;
    const code = nonEmpty(obj.code)
        ? obj.code
        : nonEmpty(obj.error)
          ? obj.error
          : undefined;
    return { message: obj.message, code, details: obj.details };
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
        const parsed: unknown = JSON.parse(text.slice(start, end + 1));
        return isRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Extracts the readable message from a chat error. Accepts an `Error`, a
 * string, or an already-parsed object. Falls back to the raw text when there
 * is no parseable `message`. Returns `undefined` for an empty error.
 */
export function parseChatError(error: unknown): ParsedChatError | undefined {
    if (error === undefined || error === null) return undefined;
    if (isRecord(error) && !(error instanceof Error)) {
        const parsed = fromEnvelope(error);
        if (parsed) return parsed;
        return { message: JSON.stringify(error) };
    }
    const raw = error instanceof Error ? error.message : String(error);
    if (!nonEmpty(raw)) return undefined;
    const obj = parseJsonObject(raw);
    const parsed = obj && fromEnvelope(obj);
    return parsed ?? { message: raw };
}
