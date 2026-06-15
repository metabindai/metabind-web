import { parseAgentSse } from "./sse";
import type {
    AgentChatRequest,
    AgentClientConfig,
    AgentEvent,
} from "./types";

const DEFAULT_BASE_URL = "https://agent.metabind.ai";

export type AgentClient = {
    /** Stream typed events from a chat request. */
    chat(
        req: AgentChatRequest,
        signal?: AbortSignal,
    ): AsyncIterable<AgentEvent>;
    /**
     * One-shot helper: collects every `text_delta` into a single string
     * and resolves on `message_stop`. Throws on `error` events. Useful for
     * non-conversational prompts (suggestions, summarization, etc.).
     */
    chatText(req: AgentChatRequest, signal?: AbortSignal): Promise<string>;
    /**
     * Low-level escape hatch — returns the raw `Response` so callers can
     * pipe the body through their own parser (e.g. an AI SDK transport
     * that needs the bytes, not the parsed events).
     */
    fetchChat(req: AgentChatRequest, signal?: AbortSignal): Promise<Response>;
    /** The resolved configuration (with defaults applied). */
    readonly config: ResolvedConfig;
};

export type ResolvedConfig = {
    baseUrl: string;
    orgId: string;
    projectId: string;
    apiKey: AgentClientConfig["apiKey"];
    fetch: typeof fetch;
    /** The full chat URL — `${baseUrl}/${orgId}/${projectId}/chat`. */
    chatUrl: string;
};

export function createAgentClient(config: AgentClientConfig): AgentClient {
    const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    const resolved: ResolvedConfig = {
        baseUrl,
        orgId: config.orgId,
        projectId: config.projectId,
        apiKey: config.apiKey,
        fetch: fetchImpl,
        chatUrl: `${baseUrl}/${config.orgId}/${config.projectId}/chat`,
    };

    async function authHeader(): Promise<string> {
        const k =
            typeof resolved.apiKey === "function"
                ? await resolved.apiKey()
                : resolved.apiKey;
        return `Bearer ${k}`;
    }

    async function fetchChat(
        req: AgentChatRequest,
        signal?: AbortSignal,
    ): Promise<Response> {
        const res = await resolved.fetch(resolved.chatUrl, {
            method: "POST",
            headers: {
                Authorization: await authHeader(),
                "Content-Type": "application/json",
                Accept: "text/event-stream",
            },
            body: JSON.stringify({ stream: true, ...req }),
            signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(
                `metabind agent /chat ${res.status}: ${text.slice(0, 500)}`,
            );
        }
        if (!res.body) {
            throw new Error("metabind agent /chat returned no body");
        }
        return res;
    }

    async function* chat(
        req: AgentChatRequest,
        signal?: AbortSignal,
    ): AsyncGenerator<AgentEvent> {
        const res = await fetchChat(req, signal);
        yield* parseAgentSse(res.body!);
    }

    async function chatText(
        req: AgentChatRequest,
        signal?: AbortSignal,
    ): Promise<string> {
        let text = "";
        for await (const ev of chat(req, signal)) {
            if (ev.type === "text_delta") {
                const t = (ev as { text?: string }).text;
                if (typeof t === "string") text += t;
            } else if (ev.type === "error") {
                throw new Error(
                    (ev as { message?: string }).message ?? "agent error",
                );
            }
        }
        return text;
    }

    return { chat, chatText, fetchChat, config: resolved };
}
