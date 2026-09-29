"use client";

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/elements/attachment.aui";
import { File } from "@/components/file";
import { ThreadFollowupSuggestions } from "@/components/assistant-ui/elements/follow-up-suggestions.aui";
import { Image } from "@/components/image";
import { MarkdownText } from "@/components/markdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/elements/reasoning.aui";
import { ToolCallBlock } from "@/components/assistant-ui/elements/tool-call";
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/elements/tool-group.aui";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { PromptBarComposer } from "@/components/promptbar/PromptBarComposer";
import { useComposerControls } from "@/components/promptbar/controls";
import Chart from "@/components/echarts/chart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AudioLinesIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  QuoteIcon,
  RefreshCwIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FC,
  type PropsWithChildren,
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

type ClarificationOption = {
  id?: string;
  label?: string;
  description?: string;
};

type ClarificationPart = {
  question?: string;
  options?: ClarificationOption[];
};

function Clarification({ part }: { part: ClarificationPart }) {
  const { send } = useComposerControls();
  const options = part.options ?? [];
  const choose = (label?: string) => {
    const text = label?.trim();
    if (!text) return;
    send?.({ role: "user", content: text });
  };
  return (
    <div
      data-slot="aui_clarification"
      className="my-1 rounded-xl border border-[#d5e3f8] bg-[#f5f8ff] px-3 py-2 text-sm"
    >
      {part.question && (
        <div className="mb-1.5 font-medium text-[#1e3a8a]">{part.question}</div>
      )}
      <div className="flex flex-col gap-1.5">
        {options.map((o, i) => (
          <button
            key={o.id ?? i}
            type="button"
            onClick={() => choose(o.label)}
            className="flex flex-col items-start rounded-lg border border-[#e8edf4] bg-white px-2.5 py-1.5 text-left transition-colors hover:border-[#2563eb] hover:bg-[#f5f8ff]"
          >
            <span className="text-[#1e3a8a]">{o.label ?? o.id}</span>
            {o.description && (
              <span className="text-xs text-[#86868b]">{o.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`. When `TaskGroup` is set, tool calls that carry a nested
 * conversation and have no registered UI render through it instead of the
 * tool group; without it they render like any other tool call.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ToolGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  ReasoningGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  TaskGroup?: ComponentType<{ group: ThreadGroupPart }> | undefined;
};

const messageGroupBy = groupPartByType({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  "tool-call": [],
  "standalone-tool-call": [],
});

type ThreadGroupKey =
  | "group-chainOfThought"
  | "group-reasoning"
  | "group-tool"
  | "group-task";

const TASK_GROUP_PATH: readonly ThreadGroupKey[] = [
  "group-chainOfThought",
  "group-task",
];

const taskAwareGroupBy = (
  part: Parameters<typeof messageGroupBy>[0],
  context?: Parameters<typeof messageGroupBy>[1],
): readonly ThreadGroupKey[] => {
  const path = messageGroupBy(part, context);
  return part.type === "tool-call" &&
    part.messages !== undefined &&
    path.length > 0 &&
    !context?.toolUIs?.[part.toolName]?.length
    ? TASK_GROUP_PATH
    : path;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
  autoFocus?: boolean | undefined;
  /** 拖拽对话条左右边缘改变宽度时回调（单位 rem）。不传则禁用边缘拖拽。 */
  onResizeWidth?: ((rem: number) => void) | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

// A switched thread that is still fetching its history: skeleton, not welcome.
const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  s.thread.isLoading &&
  !s.thread.isDisabled &&
  !s.threads.isLoading;

const ThreadHistorySkeleton: FC = () => {
  const { t } = useI18n();
  return (
  <div
    data-slot="aui_thread-history-skeleton"
    role="status"
    className="animate-in fade-in fill-mode-both flex flex-col gap-y-6 [animation-delay:150ms] [animation-duration:200ms]"
  >
    <span className="sr-only">{t("loadingConversation")}</span>
    <Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
    </div>
    <Skeleton className="ml-auto h-9 w-1/3 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-10/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
    </div>
  </div>
  );
};

export const Thread: FC<ThreadProps> = ({
  components = EMPTY_COMPONENTS,
  autoFocus = true,
  onResizeWidth,
}) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot
        isEmpty={isEmpty}
        autoFocus={autoFocus}
        onResizeWidth={onResizeWidth}
      />
    </ThreadComponentsContext.Provider>
  );
};

const ThreadRoot: FC<{
  isEmpty: boolean;
  autoFocus: boolean;
  onResizeWidth?: (rem: number) => void;
}> = ({
  isEmpty,
  autoFocus,
  onResizeWidth,
}) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);
  const colRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<null | {
    side: "left" | "right";
    startX: number;
    startWidthPx: number;
  }>(null);
  const [dragSide, setDragSide] = useState<null | "left" | "right">(null);

  // 拖拽过程中监听全局 pointermove/up，实时更新 --thread-max-width
  useEffect(() => {
    if (!dragSide) return;
    const onMove = (e: PointerEvent) => {
      const d = dragStartRef.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      // 右把手：往右拖变宽；左把手：往左拖变宽
      const newW =
        d.side === "right"
          ? d.startWidthPx + delta
          : d.startWidthPx - delta;
      const clamped = Math.min(72 * 16, Math.max(56 * 16, newW));
      onResizeWidth?.(Math.round(clamped / 16));
    };
    const onUp = () => {
      dragStartRef.current = null;
      setDragSide(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragSide, onResizeWidth]);

  const handleDown = (side: "left" | "right") => (e: React.PointerEvent) => {
    const el = colRef.current;
    if (!el || !onResizeWidth) return;
    e.preventDefault();
    dragStartRef.current = {
      side,
      startX: e.clientX,
      startWidthPx: el.getBoundingClientRect().width,
    };
    setDragSide(side);
  };

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, transparent)",
        ["--composer-radius" as string]: "1.125rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div
          ref={colRef}
          className={cn(
            "relative mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
            isEmpty && "justify-center",
          )}
        >
          {onResizeWidth && (
            <>
              <div
                data-slot="thread-resize-handle"
                data-side="left"
                onPointerDown={handleDown("left")}
                className="thread-resize-handle left-0"
              />
              <div
                data-slot="thread-resize-handle"
                data-side="right"
                onPointerDown={handleDown("right")}
                className="thread-resize-handle right-0"
              />
            </>
          )}
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>
          <AuiIf condition={isHistoryLoadingView}>
            <ThreadHistorySkeleton />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            className="mb-14 flex flex-col gap-y-6 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-5 md:pb-6",
              !isEmpty &&
                "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
            )}
          >
            <ThreadScrollToBottom />
            <ThreadFollowupSuggestions />
            <PromptBarComposer />
            <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
              <ThreadSuggestions />
            </AuiIf>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext);
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  const isSpoken = useAuiState((s) => s.message.metadata.modality === "voice");

  if (isEditing) return <EditComposer />;
  if (isSpoken) return <SpokenMessage />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessageComponent />;
};

type VoiceRunPosition = "single" | "start" | "middle" | "end";

const useVoiceRunPosition = (): VoiceRunPosition =>
  useAuiState((s) => {
    const before =
      s.thread.messages[s.message.index - 1]?.metadata.modality === "voice";
    const after =
      s.thread.messages[s.message.index + 1]?.metadata.modality === "voice";
    if (before) return after ? "middle" : "end";
    return after ? "start" : "single";
  });

const SpokenText: TextMessagePartComponent = ({ text }) => (
  <p className="aui-spoken-message-text m-0">{text}</p>
);

const SpokenMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const position = useVoiceRunPosition();
  const isSpeaking = useAuiState(
    (s) =>
      s.message.role === "assistant" && s.message.status?.type === "running",
  );
  const opensExchange = position === "start" || position === "single";
  const { t } = useI18n();

  return (
    <MessagePrimitive.Root
      data-slot="aui_spoken-message-root"
      data-role={role}
      data-voice-run={position}
      className={cn(
        "aui-spoken-message bg-muted/40 mx-2 px-3 py-1.5 [contain-intrinsic-size:auto_48px] [content-visibility:auto]",
        position === "single" && "rounded-xl py-2",
        position === "start" && "rounded-t-xl pt-2",
        position === "middle" && "-mt-6",
        position === "end" && "-mt-6 rounded-b-xl pb-2",
      )}
    >
      {opensExchange && (
        <div
          data-slot="aui_spoken-exchange-header"
          className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs"
        >
          <PhoneIcon className="size-3" aria-hidden />
          <span>{t("voiceConversation")}</span>
        </div>
      )}
      <div
        data-slot="aui_spoken-message-content"
        className="text-foreground flex items-start gap-2 text-sm leading-relaxed"
      >
        <span className="text-muted-foreground mt-1 shrink-0" aria-hidden>
          {role === "user" ? (
            <MicIcon className="size-3.5" />
          ) : (
            <AudioLinesIcon className="size-3.5" />
          )}
        </span>
        <span className="sr-only">
          {role === "user" ? t("youSaid") : t("assistantSaid")}
        </span>
        <div className="min-w-0 flex-1 wrap-break-word">
          <MessagePrimitive.Parts components={{ Text: SpokenText }} />
          {isSpeaking && (
            <span
              data-slot="aui_spoken-message-indicator"
              role="status"
              className="text-muted-foreground ms-1 animate-pulse font-sans"
              aria-label={t("assistantSpeaking")}
            >
              ●
            </span>
          )}
        </div>
        <SpokenActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const SpokenActionBar: FC = () => {
  const { t } = useI18n();
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="always"
      className="aui-spoken-action-bar text-muted-foreground flex shrink-0 gap-1"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip={t("copy")} className="size-6" />}><AuiIf condition={(s) => s.message.isCopied}>
                      <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
                    </AuiIf><AuiIf condition={(s) => !s.message.isCopied}>
                      <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
                    </AuiIf></ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  const { t } = useI18n();
  return (
    <ThreadPrimitive.ScrollToBottom render={<TooltipIconButton tooltip={t("scrollToBottom")} variant="outline" className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible" />}><ArrowDownIcon /></ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  const { t } = useI18n();
  return (
    <div className="aui-thread-welcome-root flex items-center justify-center gap-4 px-2">
      <img
        src="/dog.png"
        alt="DeepData"
        className="aui-thread-welcome-logo fade-in slide-in-from-bottom-1 size-9   animate-in shrink-0 rounded-xl object-cover"
      />
      <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 relative top-[12px] animate-in fill-mode-both text-2xl font-medium tracking-tight leading-none text-[#1d1d1f] duration-200">
        {t("welcome")}
      </p>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-col">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send render={<button type="button" className="aui-thread-welcome-suggestion group hover:bg-foreground/[0.03] focus-visible:ring-ring/50 flex w-full items-baseline gap-2.5 rounded-md px-2 py-2 text-start text-sm transition-colors outline-none focus-visible:ring-1 motion-reduce:transition-none" />}><span
                      aria-hidden
                      className="text-muted-foreground/60 group-hover:text-foreground font-mono text-xs transition-colors motion-reduce:transition-none"
                    >
                      {">"}
                    </span><span className="min-w-0 flex-1 truncate">
                      <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 text-foreground" />{" "}
                      <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" />
                    </span></SuggestionPrimitive.Trigger>
    </div>
  );
};

// 模型选择下拉框（仅前端 UI，暂未接后端）
const MODELS = ["deepseek-chat", "deepseek-reasoner"];

const ModelSelector: FC = () => {
  const { t } = useI18n();
  const [model, setModel] = useState(() => {
    try {
      return localStorage.getItem("askdata_model") || "deepseek-chat";
    } catch {
      return "deepseek-chat";
    }
  });
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = (next: string) => {
    setModel(next);
    try {
      localStorage.setItem("askdata_model", next);
    } catch {}
    setOpen(false);
  };

  return (
    <div className="model-wrap" ref={wrapRef}>
      <button
        type="button"
        className="model-btn"
        title={t("model")}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="model-name">{model}</span>
        <ChevronDownIcon className="model-caret" />
      </button>
      {open && (
        <div className="model-pop">
          <div className="model-title">{t("model")}</div>
          {MODELS.map((m) => (
            <button
              key={m}
              type="button"
              className={`lang-opt${model === m ? " active" : ""}`}
              onClick={() => choose(m)}
            >
              <span className="lang-label mono">{m}</span>
              {model === m && <CheckIcon className="lang-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Composer: FC<{ autoFocus: boolean }> = ({ autoFocus }) => {
  const { t } = useI18n();
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone render={<div data-slot="aui_composer-shell" className="border-foreground/10 focus-within:border-foreground/25 data-[dragging=true]:border-ring flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]" />}><ComposerAttachments /><ComposerPrimitive.Input
                      placeholder={t("composerPlaceholder")}
                      className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
                      rows={1}
                      autoFocus={autoFocus}
                      enterKeyHint="send"
                      aria-label={t("composerInputLabel")}
                    /><ComposerAction /></ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  const { t } = useI18n();
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <ComposerAddAttachment />
      <div className="flex items-center gap-1.5">
        <ModelSelector />
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate render={<TooltipIconButton tooltip={t("composerVoiceInput")} side="bottom" type="button" variant="ghost" size="icon" className="aui-composer-dictate text-muted-foreground hover:text-foreground size-7 rounded-full" aria-label={t("composerStartVoice")} />}><MicIcon className="aui-composer-dictate-icon size-4" /></ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation render={<TooltipIconButton tooltip={t("composerStopDictation")} side="bottom" type="button" variant="ghost" size="icon" className="aui-composer-stop-dictation text-destructive size-7 rounded-full" aria-label={t("composerStopVoice")} />}><SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" /></ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send render={<TooltipIconButton tooltip={t("composerSend")} side="bottom" type="button" variant="default" size="icon" className="aui-composer-send size-7 rounded-full" aria-label={t("composerSend")} />}><ArrowUpIcon className="aui-composer-send-icon size-4" /></ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel render={<Button type="button" variant="default" size="icon" className="aui-composer-cancel size-7 rounded-full" aria-label={t("composerCancel")} />}><SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" /></ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  const { t } = useI18n();
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <div className="flex items-start justify-between gap-3">
          <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2 min-w-0" />
          <ActionBarPrimitive.Reload
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="aui-message-error-retry flex-none px-3 text-xs"
              >
                <RefreshCwIcon className="mr-1 size-3.5" />
                {t("retry")}
              </Button>
            }
          />
        </div>
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    TaskGroup: TaskGroupComponent,
  } = useContext(ThreadComponentsContext);
  const { t } = useI18n();
  const groupBy = TaskGroupComponent ? taskAwareGroupBy : messageGroupBy;

  const ACTION_BAR_PT = "pt-1.5";
  // Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <div
        data-slot="aui_assistant-message-content"
        /* Apple Intelligence 流式：助手答案无气泡卡片，全文宽流动排版 */
        className="text-[#1d1d1f] my-1 leading-relaxed wrap-break-word"
      >
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-task":
                return TaskGroupComponent ? (
                  <TaskGroupComponent group={part} />
                ) : null;
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>;
                }
                return (
                  <ToolGroupRoot variant="ghost">
                    <ToolGroupTrigger
                      count={part.indices.length}
                      active={part.status.type === "running"}
                    />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return (
                    <ReasoningGroup group={part}>{children}</ReasoningGroup>
                  );
                }
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return (
                  part.toolUI ?? (
                    <ToolCallBlock
                      name={part.toolName}
                      args={part.args}
                      result={part.result}
                    />
                  )
                );
              case "data":
                return part.dataRendererUI;
              case "clarification":
                return <Clarification part={part} />;
              case "chart":
                return <Chart spec={part.spec} />;
              case "file":
                return (
                  <div data-slot="aui_assistant-message-file" className="py-1">
                    <File {...part} />
                  </div>
                );
              case "image":
                return (
                  <div data-slot="aui_assistant-message-image" className="py-1">
                    <Image {...part} />
                  </div>
                );
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="animate-pulse font-sans"
                    aria-label={t("assistantWorking")}
                  >
                    {"●"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  const { t } = useI18n();
  const { composerRef } = useComposerControls();
  // 读取当前助手消息的文本内容，供「引用某条回答追问」填充输入框
  const messageText = useAuiState((s) => {
    const parts = (s.message as unknown as { parts?: Array<{ type?: string; text?: string }> })?.parts ?? [];
    return parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  });
  const quoteToAsk = () => {
    const txt = (messageText || "").trim();
    if (!txt || !composerRef?.current) return;
    const q = txt.length > 500 ? `${txt.slice(0, 500)}…` : txt;
    // 把回答以引用形式填进输入框，用户可继续追加追问
    composerRef.current.setText(`[引用] ${q}\n\n请继续分析：`);
  };
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip={t("copy")} />}><AuiIf condition={(s) => s.message.isCopied}>
                      <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
                    </AuiIf><AuiIf condition={(s) => !s.message.isCopied}>
                      <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
                    </AuiIf></ActionBarPrimitive.Copy>
      <AuiIf condition={(s) => s.thread.capabilities.feedback}>
        <ActionBarPrimitive.FeedbackPositive render={<TooltipIconButton tooltip={t("helpful")} className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground" />}><ThumbsUpIcon /></ActionBarPrimitive.FeedbackPositive>
        <ActionBarPrimitive.FeedbackNegative render={<TooltipIconButton tooltip={t("notHelpful")} className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground" />}><ThumbsDownIcon /></ActionBarPrimitive.FeedbackNegative>
      </AuiIf>
      <ActionBarPrimitive.Reload render={<TooltipIconButton tooltip={t("refresh")} />}><RefreshCwIcon /></ActionBarPrimitive.Reload>
      <TooltipIconButton tooltip={t("quote")} className="aui-action-bar-quote" onClick={quoteToAsk}><QuoteIcon className="size-4" /></TooltipIconButton>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger render={<TooltipIconButton tooltip={t("more")} className="data-[state=open]:bg-accent" />}><MoreHorizontalIcon /></ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5"
        >
          <ActionBarPrimitive.ExportMarkdown render={<ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none" />}><DownloadIcon className="size-4" />{t("exportMarkdown")}
                              </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserFilePart: FileMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-file" className="py-1">
    <File {...part} />
  </div>
);

const UserImagePart: ImageMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-image" className="py-1">
    <Image {...part} />
  </div>
);

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-[#456fca] text-white rounded-(--composer-radius) px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts
            components={{ File: UserFilePart, Image: UserImagePart }}
          />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  const { t } = useI18n();
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit render={<TooltipIconButton tooltip={t("edit")} className="aui-user-action-edit" />}><PencilIcon /></ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  const { t } = useI18n();
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-foreground/10 focus-within:border-foreground/25 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg) transition-[border-color]">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel render={<Button variant="ghost" size="sm" className="h-8 px-3" />}>{t("cancel")}
                              </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button size="sm" className="h-8 px-3" />}>{t("update")}
                              </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};


