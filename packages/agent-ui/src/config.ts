// Chat configuration (Metabind-locked).
//
// The package does NOT read `import.meta.env` — the host passes Metabind
// credentials + options to `configureChat` / `mountAgentChat`, which stashes a
// resolved copy here. Module-level (one chat instance per page), mirroring the
// module-singleton MCP client.

import type { ReactNode } from "react";
import type { ChatInitDetail } from "./protocol";
import type { ChatTracer } from "./tracer";

/**
 * The project-scoped credential the agent + MCP requests authenticate with.
 * Either a plain string (e.g. a durable API key inlined at build time) or a
 * getter — sync or async — resolved fresh on every request. Use the getter form
 * when a host brokers a short-lived token that is refreshed on expiry, or to
 * defer the first request until a token has arrived (return a promise that
 * settles once it has).
 */
export type ApiKeyProvider = string | (() => string | Promise<string>);

export type AgentChatConfig = {
    /** Metabind agent proxy credentials. */
    agent: {
        /** Default: https://agent.metabind.ai */
        baseUrl?: string;
        orgId: string;
        projectId: string;
        /** Project-scoped credential for both the agent + MCP requests. A
         *  string, or a (possibly async) getter for a host-refreshed token —
         *  see {@link ApiKeyProvider}. */
        apiKey: ApiKeyProvider;
        /** Target the project's draft (unpublished) MCP server instead of the
         *  published one (MET-1271). Applies to both the agent `/chat` request
         *  and the direct MCP client used to render tool UIs. Default false.
         *  Pinned per-conversation by the proxy — to switch, remount the chat so
         *  a fresh conversation starts. */
        draft?: boolean;
    };
    /** MCP endpoint override. Default base: https://mcp.metabind.ai */
    mcp?: { baseUrl?: string };
    /** Path (or absolute URL) to the `@mcp-ui/client` sandbox proxy the host
     *  serves. Tool UIs render inside it. Default: "/sandbox_proxy.html". */
    sandboxUrl?: string;
    /** Optional per-turn tracing hook (e.g. a Langfuse-backed tracer). */
    tracer?: ChatTracer;
    /** Fallback conversation context when no INIT handshake arrives (e.g. the
     *  chat is served standalone, not inside a host shell). */
    context?: ChatInitDetail;
    /** Render the empty state shown until the first message. Defaults to the
     *  built-in `<DefaultWelcome/>`. Compose or replace it — e.g.
     *  `welcome: () => <DefaultWelcome title={name} icon={url} tiles={tiles} />`.
     *  Rendered inside the runtime providers, so it can use `StarterTile` /
     *  `ThreadPrimitive.Suggestion`. (Direct-consumer only — a component can't
     *  cross an iframe; send the DATA to your consumer and build the node there.) */
    welcome?: () => ReactNode;
    /** Expected origin of INIT messages from the host. Default: window origin. */
    origin?: string;
    /** When neither a `firstPrompt` nor a `kickoff` is seeded, open the
     *  conversation anyway so the chat never lands on the empty/welcome state:
     *  a hidden opener turn is appended and the assistant speaks first, driven
     *  by its own system prompt. Default true. */
    autoStart?: boolean;
    /** The hidden opener used by `autoStart`. Keep it content-light so the
     *  agent's system prompt owns the greeting. Default: "Hi!". */
    autoStartMessage?: string;
    /** Show the developer tool-call display (the "Used N tools" collapsible +
     *  raw arg/result cards). When false, that chrome is hidden and only the
     *  MCP UI surfaces (product carousels) render. A `?debug=1` / `?debug=0`
     *  URL param overrides this at runtime. Default false. */
    debug?: boolean;
    /** Allow the user to attach media/files in the composer (the attach button +
     *  drag-and-drop dropzone). Default false. */
    allowAttachments?: boolean;
    /** After each assistant turn, generate a few short LLM follow-up prompt
     *  buttons ("Suggested next steps") from the recent conversation. Off by
     *  default. Pass `true` for the built-in shaping instruction, or an object
     *  to customise it. */
    followUpSuggestions?: boolean | { instruction?: string };
};

/** Built-in shaping instruction for follow-up suggestions (see config). */
export const DEFAULT_FOLLOW_UP_INSTRUCTION =
    "You are drafting short follow-up prompts a user might send next. Keep each tight — ideally 3-6 words, max 40 characters — written like a button label, not a sentence. No trailing punctuation. Vary the angle (drill-in, comparison, alternative, broaden). Only return follow-up suggestions if they're relevant to the conversation.";

function resolveFollowUps(
    v: AgentChatConfig["followUpSuggestions"],
): { enabled: boolean; instruction: string } {
    if (!v) return { enabled: false, instruction: DEFAULT_FOLLOW_UP_INSTRUCTION };
    const instruction =
        (typeof v === "object" && v.instruction) || DEFAULT_FOLLOW_UP_INSTRUCTION;
    return { enabled: true, instruction };
}

export type ResolvedChatConfig = {
    agentBaseUrl: string;
    mcpUrl: string;
    orgId: string;
    projectId: string;
    apiKey: ApiKeyProvider;
    /** Whether requests target the draft MCP server (MET-1271). */
    draft: boolean;
    sandboxUrl: string;
    tracer?: ChatTracer;
    context?: ChatInitDetail;
    welcome?: () => ReactNode;
    origin?: string;
    autoStart: boolean;
    autoStartMessage: string;
    debug: boolean;
    allowAttachments: boolean;
    followUpSuggestions: { enabled: boolean; instruction: string };
};

let current: ResolvedChatConfig | undefined;

export function configureChat(config: AgentChatConfig): void {
    const agentBaseUrl = config.agent.baseUrl || "https://agent.metabind.ai";
    const mcpBaseUrl = config.mcp?.baseUrl || "https://mcp.metabind.ai";
    const draft = config.agent.draft ?? false;
    // MET-1271: the draft MCP server lives at the `/draft` URL suffix and
    // exposes the project's unpublished tools. Mirrors the proxy's own routing.
    const mcpUrl = `${mcpBaseUrl}/${config.agent.orgId}/projects/${config.agent.projectId}${
        draft ? "/draft" : ""
    }`;
    current = {
        agentBaseUrl,
        mcpUrl,
        orgId: config.agent.orgId,
        projectId: config.agent.projectId,
        apiKey: config.agent.apiKey,
        draft,
        sandboxUrl: config.sandboxUrl || "/sandbox_proxy.html",
        tracer: config.tracer,
        context: config.context,
        welcome: config.welcome,
        origin: config.origin,
        autoStart: config.autoStart ?? true,
        autoStartMessage: config.autoStartMessage || "Hi!",
        debug: config.debug ?? false,
        allowAttachments: config.allowAttachments ?? false,
        followUpSuggestions: resolveFollowUps(config.followUpSuggestions),
    };
}

export function getChatConfig(): ResolvedChatConfig {
    if (!current) {
        throw new Error(
            "@metabindai/agent-ui: chat used before configureChat(). " +
                "Call configureChat(config) — or render via mountAgentChat(el, config).",
        );
    }
    return current;
}

/**
 * Resolve the configured `apiKey` to a bearer token for the current request.
 * A string resolves instantly; a getter is invoked (and awaited) each call so
 * refreshed tokens are picked up. Empty string means "no token yet".
 */
export async function resolveApiKey(): Promise<string> {
    const { apiKey } = getChatConfig();
    return typeof apiKey === "function" ? await apiKey() : apiKey;
}
