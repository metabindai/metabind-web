import { createParser } from "eventsource-parser";
import type { AgentEvent } from "./types";

/**
 * Parses an SSE byte stream from the Metabind agent proxy into a typed
 * event sequence. The chunked-transfer / UTF-8 / `data:`-aggregation /
 * comment-line plumbing is handled by `eventsource-parser`; this only
 * adds the JSON parse and the `event:` → typed `AgentEvent` mapping.
 *
 * Uses the parser's callback API + an explicit reader loop rather than
 * `body.pipeThrough(...)` + `for await of` — Safari's `ReadableStream`
 * still doesn't implement `Symbol.asyncIterator`.
 */
export async function* parseAgentSse(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<AgentEvent> {
    const queue: AgentEvent[] = [];
    const parser = createParser({
        onEvent(e) {
            if (!e.event) return;
            const ev = toAgentEvent(e.event, e.data);
            if (ev) queue.push(ev);
        },
    });

    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
            while (queue.length > 0) yield queue.shift()!;
        }
        while (queue.length > 0) yield queue.shift()!;
    } finally {
        reader.releaseLock();
    }
}

function toAgentEvent(event: string, data: string): AgentEvent | null {
    if (!data) return { type: event } as AgentEvent;
    try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        // The proxy duplicates the event name in `data.type`; the
        // `event:` line is authoritative.
        return { ...parsed, type: event } as AgentEvent;
    } catch {
        return { type: event, data } as AgentEvent;
    }
}
