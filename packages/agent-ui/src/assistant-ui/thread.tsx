import {
    ComposerAddAttachment,
    ComposerAttachments,
    UserMessageAttachments,
} from "./attachment";
import { MarkdownText } from "./markdown-text";
import {
    Reasoning,
    ReasoningContent,
    ReasoningRoot,
    ReasoningText,
    ReasoningTrigger,
} from "./reasoning";
import {
    ToolGroupContent,
    ToolGroupRoot,
    ToolGroupTrigger,
} from "./tool-group";
import {
    ToolFallbackArgs,
    ToolFallbackContent,
    ToolFallbackError,
    ToolFallbackResult,
    ToolFallbackRoot,
    ToolFallbackTrigger,
} from "./tool-fallback";
import { ToolAppView } from "../tool-app-view";
import { EmptyStateTiles } from "../empty-state-tiles";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TooltipIconButton } from "./tooltip-icon-button";
import { Button } from "../ui/button";
import { useMcpUi } from "../mcp-ui-context";
import { useWelcomeReady } from "../welcome-gate";
import { getChatConfig } from "../config";

// Composer shell styling, shared by the attachment-enabled (dropzone) and
// attachment-disabled (plain) variants.
const COMPOSER_SHELL_CLASS =
    "flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-background p-(--composer-padding) transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50";
import { KICKOFF_SENTINEL } from "../context";
import { cn } from "../lib/utils";
import {
    ActionBarMorePrimitive,
    ActionBarPrimitive,
    AuiIf,
    BranchPickerPrimitive,
    ComposerPrimitive,
    ErrorPrimitive,
    MessagePrimitive,
    ThreadPrimitive,
    useAuiState,
} from "@assistant-ui/react";
import {
    ArrowDownIcon,
    ArrowUpIcon,
    CheckIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    CopyIcon,
    DownloadIcon,
    MoreHorizontalIcon,
    PencilIcon,
    RefreshCwIcon,
    SquareIcon,
} from "lucide-react";
import { useEffect, useState, type FC } from "react";

export const Thread: FC = () => {
    // Skip turnAnchor on the very first turn — anchoring "top" before there's
    // enough content below the user message lands it in the wrong place
    // during the empty-state → first-message transition. Once a second turn
    // exists, the anchor behaves correctly.
    const turnAnchor = useAuiState((s) =>
        s.thread.messages.length >= 3 ? "top" : undefined,
    );
    // Don't auto-scroll while the empty state is showing, or it lands at the
    // bottom of the (now taller) starter tiles instead of the top.
    const isEmpty = useAuiState((s) => s.thread.isEmpty);
    // Hold the welcome hero back until seeding resolves, so a preset/embedded
    // chat doesn't flash it before the seeded message lands.
    const welcomeReady = useWelcomeReady();
    return (
        <ThreadPrimitive.Root
            className="@container flex min-h-0 flex-1 flex-col bg-background"
            style={{
                ["--thread-max-width" as string]: "44rem",
                ["--composer-radius" as string]: "24px",
                ["--composer-padding" as string]: "10px",
            }}
        >
            <ThreadPrimitive.Viewport
                turnAnchor={turnAnchor}
                autoScroll={!isEmpty}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth"
            >
                <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col space-y-12 px-4 pt-4">
                    {welcomeReady && (
                        <AuiIf condition={(s) => s.thread.isEmpty}>
                            <ThreadWelcome />
                        </AuiIf>
                    )}
                    <ThreadPrimitive.Messages>
                        {() => <ThreadMessage />}
                    </ThreadPrimitive.Messages>
                </div>
            </ThreadPrimitive.Viewport>

            <div className="relative mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 px-4 pb-4 md:pb-6">
                <ThreadScrollToBottom />
                <Composer />
            </div>
        </ThreadPrimitive.Root>
    );
};

const ThreadMessage: FC = () => {
    const role = useAuiState((s) => s.message.role);
    const isEditing = useAuiState((s) => s.message.composer.isEditing);
    // Hidden "kickoff" turn — sent to the model to open the conversation, but
    // not shown to the user (it's prefixed with the kickoff sentinel).
    const isKickoff = useAuiState((s) => {
        if (s.message.role !== "user") return false;
        const text = s.message.parts.find((p) => p.type === "text") as
            | { text?: string }
            | undefined;
        return !!text?.text?.startsWith(KICKOFF_SENTINEL);
    });

    if (isKickoff) return null;
    if (isEditing) return <EditComposer />;
    if (role === "user") return <UserMessage />;
    return <AssistantMessage />;
};

// Renders the visual MCP UI surface (ToolAppView) for each tool call in a
// given tool group, so the surfaces appear inline with their group rather
// than after subsequent text. No "Used <tool>" header — the group row above
// already labels each call.
const ToolGroupUiSurfaces: FC<{ indices: readonly number[] }> = ({ indices }) => {
    const { uiResourceByTool } = useMcpUi();
    const parts = useAuiState((s) => s.message.parts);
    return (
        <>
            {indices.map((i) => {
                const p = parts[i];
                if (!p || p.type !== "tool-call") return null;
                const uri = uiResourceByTool.get(p.toolName);
                if (!uri) return null;
                if (p.status?.type === "incomplete" && p.status.reason === "cancelled") return null;
                return (
                    <ToolAppView
                        key={i}
                        toolName={p.toolName}
                        resourceUri={uri}
                        toolInput={
                            p.args && typeof p.args === "object"
                                ? (p.args as Record<string, unknown>)
                                : undefined
                        }
                        toolResult={
                            p.status?.type === "complete" && p.result && typeof p.result === "object"
                                ? (p.result as CallToolResult)
                                : undefined
                        }
                    />
                );
            })}
        </>
    );
};

const ThinkingIndicator: FC = () => {
    // Inside AssistantMessage: shows only while this assistant message is
    // running and no parts have arrived yet. Auto-unmounts once the first
    // text/tool part lands, since parts.length flips to > 0.
    return (
        <AuiIf
            condition={(s) =>
                s.message.status?.type === "running" && s.message.parts.length === 0
            }
        >
            <div className="aui-thinking-indicator shimmer text-muted-foreground text-sm">
                Thinking…
            </div>
        </AuiIf>
    );
};

// Inside AssistantMessage, rendered after content. Shows when the message
// is still running, has at least one part, but progress has stalled for
// >800ms (no new chunks, no growth in the trailing part). Catches the
// "LLM is generating a giant tool input" gap — the agent proxy currently
// buffers `tool_use` until the input is complete and emits no
// `input_json_delta`, so for tools with large inputs (carousels, etc.)
// the user otherwise sees no movement for tens of seconds.
const StalledIndicator: FC = () => {
    const isRunning = useAuiState((s) => s.message.status?.type === "running");
    const partsCount = useAuiState((s) => s.message.parts.length);
    // Progress key changes whenever something visible has updated — new
    // part arrived, trailing text grew, trailing tool status changed.
    // Resets the stall timer in the effect below.
    const progressKey = useAuiState((s) => {
        const parts = s.message.parts;
        if (parts.length === 0) return "0";
        const last = parts[parts.length - 1] as Record<string, unknown>;
        const t = last.type as string;
        let tail = t;
        if (t === "text" || t === "reasoning") {
            const text = (last.text as string | undefined) ?? "";
            tail = `${t}:${text.length}`;
        } else if (t === "tool-call") {
            const status = last.status as { type?: string } | undefined;
            tail = `tool:${last.toolCallId as string}:${status?.type ?? ""}`;
        }
        return `${parts.length}|${tail}`;
    });

    const [stalled, setStalled] = useState(false);
    useEffect(() => {
        setStalled(false);
        // ThinkingIndicator owns the empty-parts state; only fire here
        // once at least one part has arrived so we don't double up.
        if (!isRunning || partsCount === 0) return;
        const t = setTimeout(() => setStalled(true), 800);
        return () => clearTimeout(t);
    }, [isRunning, partsCount, progressKey]);

    if (!stalled || !isRunning || partsCount === 0) return null;
    return (
        <div className="aui-stalled-indicator shimmer text-muted-foreground text-sm mt-3">
            Working…
        </div>
    );
};

const ThreadScrollToBottom: FC = () => {
    return (
        <ThreadPrimitive.ScrollToBottom render={<TooltipIconButton tooltip="Scroll to bottom" variant="outline" className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent" />}><ArrowDownIcon /></ThreadPrimitive.ScrollToBottom>
    );
};

// Empty-state hero shown until the first message. Title/subtitle and the
// optional starter tiles are supplied via `configureChat({ welcome })`.
const ThreadWelcome: FC = () => {
    const { title, subtitle, tilesLabel, tiles } = getChatConfig().welcome;
    return (
        <div className="aui-thread-welcome-root flex grow flex-col justify-start sm:my-auto sm:justify-center">
            <div className="aui-thread-welcome-center mx-auto flex w-full max-w-2xl flex-col items-start px-8 py-8">
                <div className="aui-thread-welcome-message flex flex-col items-start space-y-1 text-left">
                    <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-2xl duration-200">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-xl delay-75 duration-200">
                            {subtitle}
                        </p>
                    )}
                </div>

                {tiles.length > 0 && (
                    <>
                        {tilesLabel && (
                            <div className="fade-in animate-in fill-mode-both w-full pt-8 pb-3 delay-100 duration-200">
                                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    {tilesLabel}
                                </span>
                            </div>
                        )}

                        <div className="aui-thread-welcome-tiles fade-in slide-in-from-bottom-1 animate-in fill-mode-both w-full delay-150 duration-200">
                            <EmptyStateTiles tiles={tiles} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const Composer: FC = () => {
    const allowAttachments = getChatConfig().allowAttachments;
    const inner = (
        <>
            {allowAttachments && <ComposerAttachments />}
            <ComposerPrimitive.Input
                placeholder="Send a message..."
                className="aui-composer-input max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none placeholder:text-muted-foreground/80"
                rows={1}
                autoFocus
                aria-label="Message input"
            />
            <ComposerAction />
        </>
    );
    return (
        <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
            {allowAttachments ? (
                // Dropzone enables drag-and-drop attaching.
                <ComposerPrimitive.AttachmentDropzone
                    render={
                        <div
                            data-slot="aui_composer-shell"
                            className={COMPOSER_SHELL_CLASS}
                        />
                    }
                >
                    {inner}
                </ComposerPrimitive.AttachmentDropzone>
            ) : (
                <div data-slot="aui_composer-shell" className={COMPOSER_SHELL_CLASS}>
                    {inner}
                </div>
            )}
        </ComposerPrimitive.Root>
    );
};

const ComposerAction: FC = () => {
    const allowAttachments = getChatConfig().allowAttachments;
    return (
        <div className="aui-composer-action-wrapper relative flex items-center justify-between">
            {/* Spacer keeps Send right-aligned when the attach button is hidden. */}
            {allowAttachments ? <ComposerAddAttachment /> : <div />}
            <AuiIf condition={(s) => !s.thread.isRunning}>
                <ComposerPrimitive.Send render={<TooltipIconButton tooltip="Send message" side="bottom" type="button" variant="default" size="icon" className="aui-composer-send size-8 rounded-full" aria-label="Send message" />}><ArrowUpIcon className="aui-composer-send-icon size-4" /></ComposerPrimitive.Send>
            </AuiIf>
            <AuiIf condition={(s) => s.thread.isRunning}>
                <ComposerPrimitive.Cancel render={<Button type="button" variant="default" size="icon" className="aui-composer-cancel size-8 rounded-full" aria-label="Stop generating" />}><SquareIcon className="aui-composer-cancel-icon size-3 fill-current" /></ComposerPrimitive.Cancel>
            </AuiIf>
        </div>
    );
};

const MessageError: FC = () => {
    return (
        <MessagePrimitive.Error>
            <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
                <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
            </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
    );
};

const AssistantMessage: FC = () => {
    // reserves space for action bar and compensates with `-mb` for consistent msg spacing
    // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
    // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
    const ACTION_BAR_PT = "pt-1.5";
    const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;
    // When debug is off, hide the tool-call chrome (the "Used N tools"
    // collapsible + raw arg/result cards). The MCP UI surfaces — the actual
    // product carousels — always render via ToolGroupUiSurfaces.
    const { debug } = useMcpUi();

    return (
        <MessagePrimitive.Root
            data-slot="aui_assistant-message-root"
            data-role="assistant"
            className="fade-in slide-in-from-bottom-1 relative animate-in duration-150 [contain-intrinsic-size:auto_300px] [content-visibility:auto]"
        >
            <div
                data-slot="aui_assistant-message-content"
                className="wrap-break-word px-2 text-foreground leading-[1.95] pb-20"
            >
                <ThinkingIndicator />
                <MessagePrimitive.GroupedParts
                    groupBy={(part) => {
                        if (part.type === "reasoning")
                            return ["group-chainOfThought", "group-reasoning"];
                        // All tool calls — UI and non-UI alike — go in the
                        // tool group as collapsible rows. The MCP UI surface
                        // for UI tools renders separately via McpUiSurfaces.
                        if (part.type === "tool-call") {
                            return ["group-tool"];
                        }
                        return null;
                    }}
                >
                    {({ part, children }) => {
                        switch (part.type) {
                            case "group-chainOfThought":
                                return <div data-slot="aui_chain-of-thought">{children}</div>;
                            case "group-reasoning": {
                                const running = part.status.type === "running";
                                return (
                                    <ReasoningRoot defaultOpen={running}>
                                        <ReasoningTrigger active={running} />
                                        <ReasoningContent aria-busy={running}>
                                            <ReasoningText>{children}</ReasoningText>
                                        </ReasoningContent>
                                    </ReasoningRoot>
                                );
                            }
                            case "group-tool": {
                                const active = part.status.type === "running";
                                return (
                                    <div className="my-4 space-y-3">
                                        {debug && (
                                            <ToolGroupRoot variant="ghost">
                                                <ToolGroupTrigger
                                                    count={part.indices.length}
                                                    active={active}
                                                    className="text-muted-foreground"
                                                />
                                                <ToolGroupContent>{children}</ToolGroupContent>
                                            </ToolGroupRoot>
                                        )}
                                        <ToolGroupUiSurfaces indices={part.indices} />
                                    </div>
                                );
                            }
                            case "text":
                                return <MarkdownText />;
                            case "reasoning":
                                return <Reasoning {...part} />;
                            case "tool-call":
                                return (
                                    <ToolFallbackRoot>
                                        <ToolFallbackTrigger
                                            toolName={part.toolName}
                                            status={part.status}
                                        />
                                        <ToolFallbackContent>
                                            <ToolFallbackError status={part.status} />
                                            <ToolFallbackArgs argsText={part.argsText} />
                                            <ToolFallbackResult result={part.result} />
                                        </ToolFallbackContent>
                                    </ToolFallbackRoot>
                                );
                            default:
                                return null;
                        }
                    }}
                </MessagePrimitive.GroupedParts>
                <StalledIndicator />
                <MessageError />
            </div>

            <div
                data-slot="aui_assistant-message-footer"
                className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
            >
                <BranchPicker />
                <AssistantActionBar />
            </div>
        </MessagePrimitive.Root>
    );
};


const AssistantActionBar: FC = () => {
    return (
        <ActionBarPrimitive.Root
            hideWhenRunning
            autohide="not-last"
            className="aui-assistant-action-bar-root col-start-3 row-start-2 -ms-1 flex gap-1 text-muted-foreground"
        >
            <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="Copy" />}><AuiIf condition={(s) => s.message.isCopied}>
                <CheckIcon />
            </AuiIf><AuiIf condition={(s) => !s.message.isCopied}>
                    <CopyIcon />
                </AuiIf></ActionBarPrimitive.Copy>
            <ActionBarPrimitive.Reload render={<TooltipIconButton tooltip="Refresh" />}><RefreshCwIcon /></ActionBarPrimitive.Reload>
            <ActionBarMorePrimitive.Root>
                <ActionBarMorePrimitive.Trigger render={<TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent" />}><MoreHorizontalIcon /></ActionBarMorePrimitive.Trigger>
                <ActionBarMorePrimitive.Content
                    side="bottom"
                    align="start"
                    className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                >
                    <ActionBarPrimitive.ExportMarkdown render={<ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground" />}><DownloadIcon className="size-4" />Export as Markdown
                    </ActionBarPrimitive.ExportMarkdown>
                </ActionBarMorePrimitive.Content>
            </ActionBarMorePrimitive.Root>
        </ActionBarPrimitive.Root>
    );
};

const UserMessage: FC = () => {
    return (
        <MessagePrimitive.Root
            data-slot="aui_user-message-root"
            className="fade-in slide-in-from-bottom-1 grid animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
            data-role="user"
        >
            <UserMessageAttachments />

            <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
                <div className="aui-user-message-content wrap-break-word peer rounded-2xl bg-muted px-4 py-2.5 text-foreground empty:hidden">
                    <MessagePrimitive.Parts />
                </div>
                <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
                    <UserActionBar />
                </div>
            </div>

            <BranchPicker
                data-slot="aui_user-branch-picker"
                className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
            />
        </MessagePrimitive.Root>
    );
};

const UserActionBar: FC = () => {
    return (
        <ActionBarPrimitive.Root
            hideWhenRunning
            autohide="not-last"
            className="aui-user-action-bar-root flex flex-col items-end"
        >
            <ActionBarPrimitive.Edit render={<TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4" />}><PencilIcon /></ActionBarPrimitive.Edit>
        </ActionBarPrimitive.Root>
    );
};

const EditComposer: FC = () => {
    return (
        <MessagePrimitive.Root
            data-slot="aui_edit-composer-wrapper"
            className="flex flex-col px-2"
        >
            <ComposerPrimitive.Root className="aui-edit-composer-root ms-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
                <ComposerPrimitive.Input
                    className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
                    autoFocus
                />
                <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
                    <ComposerPrimitive.Cancel render={<Button variant="ghost" size="sm" />}>Cancel
                    </ComposerPrimitive.Cancel>
                    <ComposerPrimitive.Send render={<Button size="sm" />}>Update</ComposerPrimitive.Send>
                </div>
            </ComposerPrimitive.Root>
        </MessagePrimitive.Root>
    );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
    className,
    ...rest
}) => {
    return (
        <BranchPickerPrimitive.Root
            hideWhenSingleBranch
            className={cn(
                "aui-branch-picker-root -ms-2 me-2 inline-flex items-center text-muted-foreground text-xs",
                className,
            )}
            {...rest}
        >
            <BranchPickerPrimitive.Previous render={<TooltipIconButton tooltip="Previous" />}><ChevronLeftIcon /></BranchPickerPrimitive.Previous>
            <span className="aui-branch-picker-state font-medium">
                <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
            </span>
            <BranchPickerPrimitive.Next render={<TooltipIconButton tooltip="Next" />}><ChevronRightIcon /></BranchPickerPrimitive.Next>
        </BranchPickerPrimitive.Root>
    );
};
