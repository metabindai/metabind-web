// Chat configuration (Metabind-locked).
//
// The package does NOT read `import.meta.env` — the host passes Metabind
// credentials + options to `configureChat` / `mountAgentChat`, which stashes a
// resolved copy here. Module-level (one chat instance per page), mirroring the
// module-singleton MCP client.

import type { ChatInitDetail } from "./protocol";
import type { EmptyStateTile } from "./empty-state-tiles";
import type { ChatTracer } from "./tracer";

/** Empty-state / welcome hero content, shown until the first message. */
export type WelcomeConfig = {
    /** Headline. Default: "How can I help?" */
    title?: string;
    /** Supporting line under the headline. Optional. */
    subtitle?: string;
    /** Label above the starter tiles. Only shown when `tiles` is non-empty. */
    tilesLabel?: string;
    /** Clickable starter-prompt tiles. Default: none. */
    tiles?: EmptyStateTile[];
};

export type AgentChatConfig = {
    /** Metabind agent proxy credentials. */
    agent: {
        /** Default: https://agent.metabind.ai */
        baseUrl?: string;
        orgId: string;
        projectId: string;
        /** Project-scoped API key (used for both the agent + MCP requests). */
        apiKey: string;
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
    /** Empty-state / welcome hero content. */
    welcome?: WelcomeConfig;
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
};

export type ResolvedChatConfig = {
    agentBaseUrl: string;
    mcpUrl: string;
    orgId: string;
    projectId: string;
    apiKey: string;
    sandboxUrl: string;
    tracer?: ChatTracer;
    context?: ChatInitDetail;
    welcome: Required<Pick<WelcomeConfig, "title" | "tiles">> &
        Pick<WelcomeConfig, "subtitle" | "tilesLabel">;
    origin?: string;
    autoStart: boolean;
    autoStartMessage: string;
    debug: boolean;
    allowAttachments: boolean;
};

let current: ResolvedChatConfig | undefined;

export function configureChat(config: AgentChatConfig): void {
    const agentBaseUrl = config.agent.baseUrl || "https://agent.metabind.ai";
    const mcpBaseUrl = config.mcp?.baseUrl || "https://mcp.metabind.ai";
    current = {
        agentBaseUrl,
        mcpUrl: `${mcpBaseUrl}/${config.agent.orgId}/projects/${config.agent.projectId}`,
        orgId: config.agent.orgId,
        projectId: config.agent.projectId,
        apiKey: config.agent.apiKey,
        sandboxUrl: config.sandboxUrl || "/sandbox_proxy.html",
        tracer: config.tracer,
        context: config.context,
        welcome: {
            title: config.welcome?.title || "How can I help?",
            subtitle: config.welcome?.subtitle,
            tilesLabel: config.welcome?.tilesLabel,
            tiles: config.welcome?.tiles ?? [],
        },
        origin: config.origin,
        autoStart: config.autoStart ?? true,
        autoStartMessage: config.autoStartMessage || "Hi!",
        debug: config.debug ?? false,
        allowAttachments: config.allowAttachments ?? false,
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
