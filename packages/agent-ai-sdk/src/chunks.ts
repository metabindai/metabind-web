import type { UIMessageChunk } from "ai";
import { parseAgentSse, type AgentEvent, type AgentUsage } from "@metabindai/agent";

export type ToolCalledInfo = {
    toolCallId: string;
    toolName: string;
    success: boolean;
};

export type TurnTool = {
    toolCallId: string;
    toolName: string;
};

export type TurnUsageInfo = {
    inputTokens: number;
    outputTokens: number;
    /** Tools observed within the turn this usage payload belongs to. */
    tools: TurnTool[];
};

export type AgentChunkOptions = {
    /** Fires when a `tool_result` lands. Buffered until `message_stop` so
     *  the consumer can resolve per-turn token attribution before the
     *  callback runs. Drained on stream close if `message_stop` never
     *  arrives. */
    onToolCalled?: (info: ToolCalledInfo) => void;
    /** Fires once per assistant turn when the proxy emits a `usage`
     *  payload on `message_stop`. Use this to record token spend and
     *  attribute it to the tool calls in `info.tools`. */
    onTurnUsage?: (info: TurnUsageInfo) => void;
};

/**
 * Translates a stream of typed `AgentEvent`s into the `UIMessageChunk`
 * format `@ai-sdk/react` (and assistant-ui through it) expects.
 *
 * Behaviour:
 * - Text and tool blocks interleave within a single assistant turn. Each
 *   text run between tool blocks becomes its own text part with a fresh
 *   id, so the UI renders text → tool card → text rather than collapsing
 *   the whole turn into one text part.
 * - `tool_use_start` → `tool-input-start`. Emits as soon as id+name land
 *   so the UI can render an in-progress card immediately.
 * - `tool_use_input_delta` → `tool-input-delta`. The `partialInput`
 *   string is forwarded verbatim as `inputTextDelta`; the AI SDK
 *   accumulates fragments client-side. Per MET-1093 the canonical event
 *   name is `tool_use_input_delta`; we also accept the older
 *   `tool_use_input_partial` for backward-compat with any proxy that
 *   shipped under the original name.
 * - `tool_use` → `tool-input-available` with `providerExecuted: true`
 *   (the proxy already ran it; the runtime won't try to invoke a local
 *   handler) and `dynamic: true` (MCP tools aren't typed in the AI SDK
 *   ToolSet). If `tool_use_start` never arrived for this id (older
 *   proxy), synthesize one before `tool-input-available`.
 * - `tool_result` is wrapped as an MCP `CallToolResult` (`{ content,
 *   isError? }`) so existing MCP-UI rendering code keeps working.
 * - `message_stop` with a `usage` payload fires `onTurnUsage` with the
 *   token counts and the tools observed in the turn. `onToolCalled`
 *   events for the turn flush *after* `onTurnUsage`, so the consumer can
 *   resolve token attribution from inside the callback.
 * - Unknown event types are dropped silently for forward compatibility.
 */
export function agentEventsToUIMessageChunks(
    events: AsyncIterable<AgentEvent>,
    opts: AgentChunkOptions = {},
): ReadableStream<UIMessageChunk> {
    const { onToolCalled, onTurnUsage } = opts;
    return new ReadableStream<UIMessageChunk>({
        async start(controller) {
            let started = false;
            let textRun = 0;
            let textOpenId: string | null = null;
            // Tracks tool ids that already received a `tool-input-start`
            // chunk, so we don't double-emit when the atomic `tool_use`
            // arrives after `tool_use_start`. Also lets the atomic-only
            // path (older proxy) synthesize a start lazily.
            const startedTools = new Set<string>();
            // Remembered so we can name each result. The atomic `tool_use`
            // (or its `tool_use_start` sibling) carries `name`; the matching
            // `tool_result` only has `toolUseId`.
            const toolNameById = new Map<string, string>();
            // Tool-call events are deferred until `message_stop` so the
            // consumer can read per-turn token usage from `onTurnUsage`
            // before `onToolCalled` fires. Also drained on stream close
            // so calls in a turn that errored before `message_stop` still
            // get reported.
            const toolCalledQueue: ToolCalledInfo[] = [];
            const flushToolCalled = () => {
                if (!onToolCalled || toolCalledQueue.length === 0) {
                    toolCalledQueue.length = 0;
                    return;
                }
                for (const info of toolCalledQueue) onToolCalled(info);
                toolCalledQueue.length = 0;
            };
            // Tools observed in the current turn (between message_start and
            // message_stop). Reported alongside the turn's usage payload so
            // the consumer can attribute the turn's spend to the calls
            // that ran. Keyed by id so a duplicate `tool_use_start` +
            // `tool_use` doesn't double-count.
            const turnTools = new Map<string, TurnTool>();
            const noteTool = (id: string, name: string) => {
                if (turnTools.has(id)) return;
                turnTools.set(id, { toolCallId: id, toolName: name });
            };
            const ensureStart = () => {
                if (started) return;
                started = true;
                controller.enqueue({ type: "start" });
                controller.enqueue({ type: "start-step" });
            };
            const closeOpenText = () => {
                if (textOpenId) {
                    controller.enqueue({ type: "text-end", id: textOpenId });
                    textOpenId = null;
                }
            };
            const openText = (): string => {
                ensureStart();
                if (textOpenId) return textOpenId;
                textOpenId = `agent-text-${textRun++}`;
                controller.enqueue({ type: "text-start", id: textOpenId });
                return textOpenId;
            };
            const ensureToolStart = (id: string, name: string) => {
                if (startedTools.has(id)) return;
                startedTools.add(id);
                controller.enqueue({
                    type: "tool-input-start",
                    toolCallId: id,
                    toolName: name,
                    providerExecuted: true,
                    dynamic: true,
                });
            };

            try {
                for await (const ev of events) {
                    switch (ev.type) {
                        case "message_start":
                            ensureStart();
                            break;
                        case "text_delta": {
                            const delta = (ev as { text?: string }).text ?? "";
                            if (!delta) break;
                            const id = openText();
                            controller.enqueue({
                                type: "text-delta",
                                id,
                                delta,
                            });
                            break;
                        }
                        case "tool_use_start": {
                            closeOpenText();
                            const e = ev as { id?: string; name?: string };
                            if (!e.id || !e.name) break;
                            ensureStart();
                            ensureToolStart(e.id, e.name);
                            noteTool(e.id, e.name);
                            toolNameById.set(e.id, e.name);
                            break;
                        }
                        case "tool_use_input_delta":
                        case "tool_use_input_partial": {
                            const e = ev as {
                                id?: string;
                                partialInput?: unknown;
                            };
                            if (!e.id) break;
                            // The AI SDK appends `inputTextDelta` to a
                            // running buffer; it must be a string. The
                            // server contract specifies a JSON-fragment
                            // string, but coerce defensively in case a
                            // provider shim sends a value.
                            const delta =
                                typeof e.partialInput === "string"
                                    ? e.partialInput
                                    : e.partialInput == null
                                      ? ""
                                      : JSON.stringify(e.partialInput);
                            if (!delta) break;
                            controller.enqueue({
                                type: "tool-input-delta",
                                toolCallId: e.id,
                                inputTextDelta: delta,
                            });
                            break;
                        }
                        case "tool_use": {
                            closeOpenText();
                            const e = ev as {
                                id?: string;
                                name?: string;
                                input?: unknown;
                            };
                            if (!e.id || !e.name) break;
                            ensureStart();
                            // Synthesize a start if `tool_use_start` never
                            // arrived (older proxy). No-op if it did.
                            ensureToolStart(e.id, e.name);
                            noteTool(e.id, e.name);
                            toolNameById.set(e.id, e.name);
                            controller.enqueue({
                                type: "tool-input-available",
                                toolCallId: e.id,
                                toolName: e.name,
                                input: e.input ?? {},
                                providerExecuted: true,
                                dynamic: true,
                            });
                            break;
                        }
                        case "tool_result": {
                            const e = ev as {
                                toolUseId?: string;
                                content?: unknown;
                                isError?: boolean;
                            };
                            if (!e.toolUseId) break;
                            const output = {
                                content: Array.isArray(e.content)
                                    ? e.content
                                    : [],
                                ...(e.isError ? { isError: true } : {}),
                            };
                            controller.enqueue({
                                type: "tool-output-available",
                                toolCallId: e.toolUseId,
                                output,
                                providerExecuted: true,
                                dynamic: true,
                            });
                            if (onToolCalled) {
                                toolCalledQueue.push({
                                    toolCallId: e.toolUseId,
                                    toolName:
                                        toolNameById.get(e.toolUseId) ?? "",
                                    success: !e.isError,
                                });
                                toolNameById.delete(e.toolUseId);
                            }
                            break;
                        }
                        case "message_stop": {
                            closeOpenText();
                            const usage = (ev as { usage?: AgentUsage }).usage;
                            if (usage) {
                                onTurnUsage?.({
                                    inputTokens: usage.inputTokens ?? 0,
                                    outputTokens: usage.outputTokens ?? 0,
                                    tools: Array.from(turnTools.values()),
                                });
                            }
                            turnTools.clear();
                            // Flush AFTER onTurnUsage so the consumer's
                            // `onToolCalled` callback can resolve token
                            // attribution synchronously.
                            flushToolCalled();
                            controller.enqueue({ type: "finish-step" });
                            controller.enqueue({ type: "finish" });
                            break;
                        }
                        case "error": {
                            const msg =
                                (ev as { message?: string }).message ??
                                "agent error";
                            controller.enqueue({
                                type: "error",
                                errorText: msg,
                            });
                            break;
                        }
                        default:
                            break;
                    }
                }
            } catch (err) {
                controller.enqueue({
                    type: "error",
                    errorText: err instanceof Error ? err.message : String(err),
                });
            } finally {
                // Turn ended without a `message_stop` (network error,
                // aborted, etc.). Drain anything still buffered so we
                // don't silently swallow tool calls that completed before
                // the stream died — their token attribution will just be
                // absent on the consumer side.
                flushToolCalled();
                controller.close();
            }
        },
    });
}

/**
 * Convenience: parse SSE bytes and translate to UIMessageChunk in one
 * step. Used by the transport's `processResponseStream`.
 */
export function agentSseToUIMessageChunks(
    body: ReadableStream<Uint8Array>,
    opts: AgentChunkOptions = {},
): ReadableStream<UIMessageChunk> {
    return agentEventsToUIMessageChunks(parseAgentSse(body), opts);
}
