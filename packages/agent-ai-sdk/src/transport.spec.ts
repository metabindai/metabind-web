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

function stubProxy(replies: object[][]): Body[] {
    const bodies: Body[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        const events = replies[bodies.length - 1] ?? DONE;
        return new Response(sse(events), {
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

    it("resends the full history when the first turn failed before the proxy stored it", async () => {
        const bodies = stubProxy([
            [{ type: "message_start" }, { type: "error", message: "overloaded" }],
            DONE,
        ]);
        const t = makeTransport();
        const u1 = user("u1", "My name is Ada.");
        const a1 = assistant("a1", "partial");
        const u2 = user("u2", "What is my name?");

        await send(t, "chat-1", [u1]);
        await send(t, "chat-1", [u1, a1, u2]);

        expect(texts(bodies[1])).toEqual([
            "user:My name is Ada.",
            "assistant:partial",
            "user:What is my name?",
        ]);
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
});
