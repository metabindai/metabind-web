import { describe, expect, it } from "vitest";
import { parseAgentSse } from "./sse";
import type { AgentEvent } from "./types";

function stringStream(s: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(s));
            controller.close();
        },
    });
}

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const c of chunks) controller.enqueue(encoder.encode(c));
            controller.close();
        },
    });
}

async function collect(
    body: ReadableStream<Uint8Array>,
): Promise<AgentEvent[]> {
    const out: AgentEvent[] = [];
    for await (const ev of parseAgentSse(body)) out.push(ev);
    return out;
}

describe("parseAgentSse", () => {
    it("parses a complete event with JSON data", async () => {
        const sse =
            "event: text_delta\ndata: {\"text\":\"hello\"}\n\n" +
            "event: message_stop\ndata: {\"usage\":{\"inputTokens\":10,\"outputTokens\":3}}\n\n";
        const events = await collect(stringStream(sse));
        expect(events).toEqual([
            { type: "text_delta", text: "hello" },
            {
                type: "message_stop",
                usage: { inputTokens: 10, outputTokens: 3 },
            },
        ]);
    });

    it("uses the event: line as authoritative type even if data.type differs", async () => {
        const sse = "event: text_delta\ndata: {\"type\":\"WRONG\",\"text\":\"x\"}\n\n";
        const events = await collect(stringStream(sse));
        expect(events[0].type).toBe("text_delta");
        expect((events[0] as { text?: string }).text).toBe("x");
    });

    it("emits a typed event with no payload when data is empty", async () => {
        const sse = "event: message_start\ndata: \n\n";
        const events = await collect(stringStream(sse));
        expect(events).toEqual([{ type: "message_start" }]);
    });

    it("falls back to a raw-data event when data is not valid JSON", async () => {
        const sse = "event: error\ndata: not-json\n\n";
        const events = await collect(stringStream(sse));
        expect(events[0]).toEqual({ type: "error", data: "not-json" });
    });

    it("aggregates across chunk boundaries", async () => {
        // Split a single event mid-data — eventsource-parser must buffer
        // until the blank line.
        const events = await collect(
            chunkedStream([
                "event: text_delta\ndata: {\"te",
                "xt\":\"split\"}\n",
                "\n",
            ]),
        );
        expect(events).toEqual([{ type: "text_delta", text: "split" }]);
    });

    it("ignores SSE messages with no event: line", async () => {
        // Per the parser, only events with an explicit `event:` field
        // are surfaced — bare `data:` lines are dropped.
        const sse = "data: {\"text\":\"x\"}\n\nevent: text_delta\ndata: {\"text\":\"y\"}\n\n";
        const events = await collect(stringStream(sse));
        expect(events).toEqual([{ type: "text_delta", text: "y" }]);
    });
});
