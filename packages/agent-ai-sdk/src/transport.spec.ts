import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { MetabindAgentTransport } from "./transport";

// Drives the real transport through `sendMessages` (what `useChat` calls) with
// `fetch` stubbed to a scripted proxy, and records every outbound body.

type Body = {
    messages: { role: string; content: string }[];
    conversationId: string;
};

const DONE = [
    { type: "message_start" },
    { type: "text_delta", text: "ok" },
    { type: "message_stop", stopReason: "end_turn" },
];

function sse(events: object[]): string {
    return events
        .map((e) => {
            const type = (e as { type: string }).type;
            return `event: ${type}\ndata: ${JSON.stringify(e)}\n\n`;
        })
        .join("");
}

// A scripted reply: the SSE events of a turn that runs to its end, a turn
// whose stream stays open until the client aborts it (the user pressed Stop),
// or an HTTP error the proxy returns before it runs the turn.
type Reply = object[] | { stopped: object[] } | { status: number };

function stubProxy(replies: Reply[]): Body[] {
    const bodies: Body[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        const reply = replies[bodies.length - 1] ?? DONE;
        if ("status" in reply) {
            return new Response("rejected", { status: reply.status });
        }
        if ("stopped" in reply) {
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(
                        new TextEncoder().encode(sse(reply.stopped)),
                    );
                    init.signal?.addEventListener("abort", () =>
                        controller.error(init.signal?.reason),
                    );
                },
            });
            return new Response(body, {
                headers: { "content-type": "text/event-stream" },
            });
        }
        return new Response(sse(reply), {
            headers: { "content-type": "text/event-stream" },
        });
    });
    return bodies;
}

function user(id: string, text: string): UIMessage {
    return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string): UIMessage {
    return { id, role: "assistant", parts: [{ type: "text", text }] };
}

async function send(
    transport: MetabindAgentTransport,
    chatId: string,
    messages: UIMessage[],
): Promise<void> {
    const stream = await transport.sendMessages({
        chatId,
        messages,
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: undefined,
    });
    const reader = stream.getReader();
    while (!(await reader.read()).done) {
        // drain, as the AI SDK does
    }
}

// Starts a turn and presses Stop once part of the reply has arrived: the AI
// SDK aborts the fetch, so the proxy's stream ends without `message_stop`.
async function sendAndStop(
    transport: MetabindAgentTransport,
    chatId: string,
    messages: UIMessage[],
): Promise<void> {
    const abort = new AbortController();
    const stream = await transport.sendMessages({
        chatId,
        messages,
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: abort.signal,
    });
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "text-delta" || value.type === "tool-input-available") {
            abort.abort();
        }
    }
}

function makeTransport(leadingContext?: () => string | undefined) {
    return new MetabindAgentTransport({
        baseUrl: "http://proxy.test",
        orgId: "org",
        projectId: "proj",
        apiKey: "key",
        leadingContext,
    });
}

const texts = (b: Body) => b.messages.map((m) => `${m.role}:${m.content}`);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("MetabindAgentTransport outbound messages", () => {
    it("sends only the newest user message once the proxy stored the conversation", async () => {
        const bodies = stubProxy([DONE, DONE, DONE]);
        const t = makeTransport();
        const u1 = user("u1", "My name is Ada.");
        const a1 = assistant("a1", "Hi Ada.");
        const u2 = user("u2", "What is 2+2?");
        const a2 = assistant("a2", "4.");
        const u3 = user("u3", "What is my name?");

        await send(t, "chat-1", [u1]);
        await send(t, "chat-1", [u1, a1, u2]);
        await send(t, "chat-1", [u1, a1, u2, a2, u3]);

        // The proxy appends `messages` to its stored history for
        // `conversationId`, so replaying earlier turns would duplicate them.
        expect(bodies.map(texts)).toEqual([
            ["user:My name is Ada."],
            ["user:What is 2+2?"],
            ["user:What is my name?"],
        ]);
        expect(bodies.every((b) => b.conversationId === "chat-1")).toBe(true);
    });

    it("sends only the newest user message after a first turn that ended in an error", async () => {
        const bodies = stubProxy([
            [
                { type: "message_start" },
                { type: "error", code: "provider_error", message: "overloaded" },
            ],
            DONE,
        ]);
        const t = makeTransport(() => "scenario A");
        const u1 = user("u1", "My name is Ada.");
        const a1 = assistant("a1", "partial");
        const u2 = user("u2", "What is my name?");

        await send(t, "chat-1", [u1]);
        await send(t, "chat-1", [u1, a1, u2]);

        // The proxy stores a turn that ends in an `error` event once it has
        // sent `message_start` (the orchestrator yields the error and returns
        // its history, which the chat handler saves), so turn one and its
        // leading context are already stored.
        expect(texts(bodies[1])).toEqual(["user:What is my name?"]);
    });

    it("keeps sending only the newest user message after a later turn fails", async () => {
        const bodies = stubProxy([
            DONE,
            [{ type: "message_start" }, { type: "error", message: "overloaded" }],
            DONE,
        ]);
        const t = makeTransport();
        const u1 = user("u1", "one");
        const a1 = assistant("a1", "r1");
        const u2 = user("u2", "two");
        const a2 = assistant("a2", "partial");
        const u3 = user("u3", "three");

        await send(t, "chat-1", [u1]);
        await send(t, "chat-1", [u1, a1, u2]);
        await send(t, "chat-1", [u1, a1, u2, a2, u3]);

        // The proxy still holds turn one, so nothing earlier is replayed.
        expect(texts(bodies[2])).toEqual(["user:three"]);
    });

    it("sends the full history for a conversation id the transport has not seen", async () => {
        const bodies = stubProxy([DONE, DONE]);
        const t = makeTransport();

        await send(t, "chat-1", [user("u1", "first chat")]);
        await send(t, "chat-2", [
            user("u1", "restored"),
            assistant("a1", "reply"),
            user("u2", "next"),
        ]);

        expect(texts(bodies[1])).toEqual([
            "user:restored",
            "assistant:reply",
            "user:next",
        ]);
    });

    it("sends leading context on the first turn and again only when it changes", async () => {
        const bodies = stubProxy([DONE, DONE, DONE]);
        let ctx = "scenario A";
        const t = makeTransport(() => ctx);
        const u1 = user("u1", "one");
        const a1 = assistant("a1", "r1");
        const u2 = user("u2", "two");
        const a2 = assistant("a2", "r2");
        const u3 = user("u3", "three");

        await send(t, "chat-1", [u1]);
        await send(t, "chat-1", [u1, a1, u2]);
        ctx = "scenario B";
        await send(t, "chat-1", [u1, a1, u2, a2, u3]);

        expect(bodies.map(texts)).toEqual([
            ["user:scenario A", "user:one"],
            ["user:two"],
            ["user:scenario B", "user:three"],
        ]);
    });
    it("resends a stopped turn, with its partial reply, alongside the next message", async () => {
        const bodies = stubProxy([
            DONE,
            { stopped: [{ type: "message_start" }, { type: "text_delta", text: "Compound interest is" }] },
            DONE,
            DONE,
        ]);
        const t = makeTransport();
        const u1 = user("u1", "My code word is PELICAN.");
        const a1 = assistant("a1", "Noted.");
        const u2 = user("u2", "Explain compound interest.");
        const a2 = assistant("a2", "Compound interest is");
        const u3 = user("u3", "What was my code word, and what were you explaining?");
        const a3 = assistant("a3", "PELICAN; compound interest.");
        const u4 = user("u4", "Thanks.");

        await send(t, "chat-1", [u1]);
        await sendAndStop(t, "chat-1", [u1, a1, u2]);
        await send(t, "chat-1", [u1, a1, u2, a2, u3]);
        await send(t, "chat-1", [u1, a1, u2, a2, u3, a3, u4]);

        // The proxy has not stored the stopped turn when the next message
        // arrives, so that turn goes out again with it. Once a turn finishes,
        // only the newest message is sent again.
        expect(bodies.map(texts)).toEqual([
            ["user:My code word is PELICAN."],
            ["user:Explain compound interest."],
            [
                "user:Explain compound interest.",
                "assistant:Compound interest is",
                "user:What was my code word, and what were you explaining?",
            ],
            ["user:Thanks."],
        ]);
    });

    it("resends the whole history and leading context when the first turn was stopped", async () => {
        const bodies = stubProxy([
            { stopped: [{ type: "message_start" }, { type: "text_delta", text: "Hel" }] },
            DONE,
            DONE,
        ]);
        const t = makeTransport(() => "scenario A");
        const u1 = user("u1", "one");
        const a1 = assistant("a1", "Hel");
        const u2 = user("u2", "two");
        const a2 = assistant("a2", "r2");
        const u3 = user("u3", "three");

        await sendAndStop(t, "chat-1", [u1]);
        await send(t, "chat-1", [u1, a1, u2]);
        await send(t, "chat-1", [u1, a1, u2, a2, u3]);

        expect(bodies.map(texts)).toEqual([
            ["user:scenario A", "user:one"],
            ["user:scenario A", "user:one", "assistant:Hel", "user:two"],
            ["user:three"],
        ]);
    });

    it("drops a stopped reply that has no text but still resends its user message", async () => {
        const bodies = stubProxy([
            DONE,
            {
                stopped: [
                    { type: "message_start" },
                    { type: "tool_use", id: "t1", name: "get_accounts", input: {} },
                ],
            },
            DONE,
        ]);
        const t = makeTransport();
        const u1 = user("u1", "one");
        const a1 = assistant("a1", "r1");
        const u2 = user("u2", "Show my accounts.");
        const a2: UIMessage = {
            id: "a2",
            role: "assistant",
            parts: [
                {
                    type: "dynamic-tool",
                    toolName: "get_accounts",
                    toolCallId: "t1",
                    state: "input-available",
                    input: {},
                },
            ],
        };
        const u3 = user("u3", "Never mind, what is 2+2?");

        await send(t, "chat-1", [u1]);
        await sendAndStop(t, "chat-1", [u1, a1, u2]);
        await send(t, "chat-1", [u1, a1, u2, a2, u3]);

        expect(texts(bodies[2])).toEqual([
            "user:Show my accounts.",
            "user:Never mind, what is 2+2?",
        ]);
    });

    it("resends a message the proxy rejected before running its turn", async () => {
        const bodies = stubProxy([DONE, { status: 429 }, DONE]);
        const t = makeTransport();
        const u1 = user("u1", "one");
        const a1 = assistant("a1", "r1");
        const u2 = user("u2", "two");
        const u3 = user("u3", "three");

        await send(t, "chat-1", [u1]);
        await expect(send(t, "chat-1", [u1, a1, u2])).rejects.toThrow();
        await send(t, "chat-1", [u1, a1, u2, u3]);

        expect(texts(bodies[2])).toEqual(["user:two", "user:three"]);
    });

    it("sends the newest user message when regenerating a stored turn", async () => {
        const bodies = stubProxy([DONE, DONE]);
        const t = makeTransport();
        const u1 = user("u1", "one");

        await send(t, "chat-1", [u1]);
        // Regenerate drops the reply and resends the thread ending at `u1`,
        // which the proxy already stored; it never gets an empty body.
        await send(t, "chat-1", [u1]);

        expect(texts(bodies[1])).toEqual(["user:one"]);
    });
});
