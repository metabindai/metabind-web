import { createRoot, type Root } from "react-dom/client";
import { StrictMode } from "react";
import { configureChat, type AgentChatConfig } from "./config";
import { AgentChat } from "./index";

export type { AgentChatConfig } from "./config";
export { AgentChat } from "./index";
export type { ChatTracer } from "./tracer";

/**
 * Mount the agent chat into a DOM element and return an unmount cleanup. Use
 * this for a plain page/route, or serve it at the route a host shell points its
 * `chatUrl` at.
 *
 * When a tool renders an MCP UI surface, the host also needs to serve
 * `sandbox_proxy.html` (from `@mcp-ui/client`) at its base URL — tool UIs
 * render inside that sandbox. Point `configureChat({ sandboxUrl })` at it.
 */
export function mountAgentChat(
    el: HTMLElement,
    config: AgentChatConfig,
): () => void {
    configureChat(config);
    const root: Root = createRoot(el);
    root.render(
        <StrictMode>
            <AgentChat />
        </StrictMode>,
    );
    return () => root.unmount();
}
