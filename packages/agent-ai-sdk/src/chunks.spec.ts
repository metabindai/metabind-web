import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@metabindai/agent";
import type { UIMessageChunk } from "ai";
import {
    agentEventsToUIMessageChunks,
    type ToolCalledInfo,
    type TurnUsageInfo,
} from "./chunks";

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) yield item;
}

async function collect(
    stream: ReadableStream<UIMessageChunk>,
): Promise<UIMessageChunk[]> {
    const out: UIMessageChunk[] = [];
    const reader = stream.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out.push(value);
    }
    return out;
}

async function run(events: AgentEvent[], opts = {}): Promise<UIMessageChunk[]> {
    return collect(agentEventsToUIMessageChunks(fromArray(events), opts));
}

describe("agentEventsToUIMessageChunks — text", () => {
    it("opens / streams / closes a text run inside a start/start-step/finish-step/finish envelope", async () => {
        const chunks = await run([
            { type: "message_start" },
            { type: "text_delta", text: "hello " },
            { type: "text_delta", text: "world" },
            { type: "message_stop" },
        ]);

        expect(chunks.map((c) => c.type)).toEqual([
            "start",
            "start-step",
            "text-start",
            "text-delta",
            "text-delta",
            "text-end",
            "finish-step",
            "finish",
        ]);
        const deltas = chunks.filter(
            (c): c is Extract<UIMessageChunk, { type: "text-delta" }> =>
                c.type === "text-delta",
        );
        expect(deltas.map((c) => c.delta).join("")).toBe("hello world");
        // Both deltas share the same text id as their open `text-start`.
        const open = chunks.find(
            (c): c is Extract<UIMessageChunk, { type: "text-start" }> =>
                c.type === "text-start",
        )!;
        expect(deltas.every((c) => c.id === open.id)).toBe(true);
    });

    it("drops empty text deltas without opening a text part", async () => {
        const chunks = await run([
            { type: "text_delta", text: "" },
            { type: "message_stop" },
        ]);
        expect(chunks.some((c) => c.type === "text-start")).toBe(false);
    });
});

describe("agentEventsToUIMessageChunks — tools", () => {
    it("text → tool → text closes the first text run and opens a fresh one after the tool", async () => {
        const chunks = await run([
            { type: "text_delta", text: "before " },
            {
                type: "tool_use",
                id: "t1",
                name: "search",
                input: { q: "x" },
            },
            {
                type: "tool_result",
                toolUseId: "t1",
                content: [{ type: "text", text: "ok" }],
            },
            { type: "text_delta", text: "after" },
            { type: "message_stop" },
        ]);

        const textStarts = chunks.filter((c) => c.type === "text-start");
        const textEnds = chunks.filter((c) => c.type === "text-end");
        expect(textStarts).toHaveLength(2);
        expect(textEnds).toHaveLength(2);
        // The two runs use distinct ids so the UI renders them as
        // separate parts straddling the tool card.
        expect(
            (textStarts[0] as { id: string }).id !==
                (textStarts[1] as { id: string }).id,
        ).toBe(true);
    });

    it("tool_use without a prior tool_use_start synthesizes a tool-input-start", async () => {
        const chunks = await run([
            {
                type: "tool_use",
                id: "t1",
                name: "search",
                input: { q: "x" },
            },
            { type: "message_stop" },
        ]);
        const starts = chunks.filter((c) => c.type === "tool-input-start");
        const avail = chunks.filter((c) => c.type === "tool-input-available");
        expect(starts).toHaveLength(1);
        expect(avail).toHaveLength(1);
        // Order: tool-input-start strictly precedes tool-input-available.
        expect(chunks.indexOf(starts[0])).toBeLessThan(chunks.indexOf(avail[0]));
    });

    it("tool_use_start followed by tool_use does not emit a duplicate tool-input-start", async () => {
        const chunks = await run([
            { type: "tool_use_start", id: "t1", name: "search" },
            {
                type: "tool_use",
                id: "t1",
                name: "search",
                input: { q: "x" },
            },
            { type: "message_stop" },
        ]);
        expect(chunks.filter((c) => c.type === "tool-input-start")).toHaveLength(1);
    });

    it("forwards tool_use_input_delta partialInput verbatim as inputTextDelta", async () => {
        const chunks = await run([
            { type: "tool_use_start", id: "t1", name: "search" },
            { type: "tool_use_input_delta", id: "t1", partialInput: '{"q":"' },
            { type: "tool_use_input_delta", id: "t1", partialInput: 'hi"}' },
            { type: "message_stop" },
        ]);
        const deltas = chunks.filter(
            (c): c is Extract<UIMessageChunk, { type: "tool-input-delta" }> =>
                c.type === "tool-input-delta",
        );
        expect(deltas.map((c) => c.inputTextDelta).join("")).toBe('{"q":"hi"}');
    });

    it("accepts the legacy tool_use_input_partial event name", async () => {
        const chunks = await run([
            { type: "tool_use_start", id: "t1", name: "search" },
            { type: "tool_use_input_partial", id: "t1", partialInput: "x" },
            { type: "message_stop" },
        ]);
        expect(chunks.some((c) => c.type === "tool-input-delta")).toBe(true);
    });

    it("wraps tool_result content as a CallToolResult and propagates isError", async () => {
        const chunks = await run([
            {
                type: "tool_use",
                id: "t1",
                name: "search",
                input: {},
            },
            {
                type: "tool_result",
                toolUseId: "t1",
                content: [{ type: "text", text: "boom" }],
                isError: true,
            },
            { type: "message_stop" },
        ]);
        const out = chunks.find(
            (c): c is Extract<UIMessageChunk, { type: "tool-output-available" }> =>
                c.type === "tool-output-available",
        )!;
        expect(out.toolCallId).toBe("t1");
        expect(out.output).toEqual({
            content: [{ type: "text", text: "boom" }],
            isError: true,
        });
    });
});

describe("agentEventsToUIMessageChunks — callbacks", () => {
    it("fires onTurnUsage on message_stop with the turn's tool list", async () => {
        const onTurnUsage = vi.fn();
        await run(
            [
                { type: "tool_use", id: "t1", name: "search", input: {} },
                {
                    type: "tool_result",
                    toolUseId: "t1",
                    content: [],
                },
                {
                    type: "message_stop",
                    usage: { inputTokens: 10, outputTokens: 5 },
                },
            ],
            { onTurnUsage },
        );
        expect(onTurnUsage).toHaveBeenCalledTimes(1);
        const arg = onTurnUsage.mock.calls[0][0] as TurnUsageInfo;
        expect(arg.inputTokens).toBe(10);
        expect(arg.outputTokens).toBe(5);
        expect(arg.tools).toEqual([{ toolCallId: "t1", toolName: "search" }]);
    });

    it("fires onToolCalled after onTurnUsage so consumers can resolve token attribution synchronously", async () => {
        const order: string[] = [];
        const onTurnUsage = vi.fn(() => {
            order.push("turn-usage");
        });
        const onToolCalled = vi.fn((info: ToolCalledInfo) => {
            order.push(`tool-called:${info.toolName}`);
        });

        await run(
            [
                { type: "tool_use", id: "t1", name: "search", input: {} },
                {
                    type: "tool_result",
                    toolUseId: "t1",
                    content: [],
                },
                {
                    type: "message_stop",
                    usage: { inputTokens: 1, outputTokens: 1 },
                },
            ],
            { onTurnUsage, onToolCalled },
        );

        expect(order).toEqual(["turn-usage", "tool-called:search"]);
    });

    it("flushes buffered onToolCalled events even when message_stop never arrives", async () => {
        // The source ends without a `message_stop` — the chunk
        // translator's `finally` block must still flush queued tool
        // callbacks so the consumer doesn't silently lose them.
        const onToolCalled = vi.fn();
        await run(
            [
                { type: "tool_use", id: "t1", name: "search", input: {} },
                {
                    type: "tool_result",
                    toolUseId: "t1",
                    content: [],
                },
            ],
            { onToolCalled },
        );
        expect(onToolCalled).toHaveBeenCalledTimes(1);
        expect(onToolCalled.mock.calls[0][0]).toEqual({
            toolCallId: "t1",
            toolName: "search",
            success: true,
        });
    });

    it("marks tool calls with isError as success: false", async () => {
        const onToolCalled = vi.fn();
        await run(
            [
                { type: "tool_use", id: "t1", name: "search", input: {} },
                {
                    type: "tool_result",
                    toolUseId: "t1",
                    content: [],
                    isError: true,
                },
                { type: "message_stop" },
            ],
            { onToolCalled },
        );
        expect(onToolCalled.mock.calls[0][0].success).toBe(false);
    });
});

describe("agentEventsToUIMessageChunks — errors", () => {
    it("turns an error event into an error chunk", async () => {
        const chunks = await run([{ type: "error", message: "boom" }]);
        const err = chunks.find(
            (c): c is Extract<UIMessageChunk, { type: "error" }> =>
                c.type === "error",
        );
        expect(err?.errorText).toBe("boom");
    });
});
