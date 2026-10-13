"use client";

import "@assistant-ui/react-markdown/styles/dot.css";
import "highlight.js/styles/github.css";

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { type FC, memo, useEffect, useMemo, useRef, useState } from "react";
import {
  useAuiState,
  useMessagePartText,
  type TextMessagePartProps,
} from "@assistant-ui/react";
import { CheckIcon, ChevronRightIcon, CircleHelpIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { useComposerControls } from "@/components/promptbar/controls";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type MarkdownTextProps = Partial<TextMessagePartProps> & {
  components?: Parameters<typeof memoizeMarkdownComponents>[0];
};

const useShallowStable = <T extends Record<string, unknown> | undefined>(
  value: T,
): T => {
  const ref = useRef(value);
  if (value !== ref.current) {
    const prev = ref.current;
    const stable =
      value !== undefined &&
      prev !== undefined &&
      Object.keys(prev).length === Object.keys(value).length &&
      Object.keys(value).every((key) => prev[key] === value[key]);
    if (!stable) ref.current = value;
  }
  return ref.current;
};

const MarkdownTextImpl: FC<MarkdownTextProps> = ({ components }) => {
  const stableComponents = useShallowStable(components);
  const markdownComponents = useMemo(() => {
    if (!stableComponents) return defaultComponents;
    return {
      ...defaultComponents,
      ...memoizeMarkdownComponents(stableComponents),
    };
  }, [stableComponents]);

  const text = (useMessagePartText()?.text ?? "") as string;
  const running = useAuiState((s) => s.thread.isRunning);
  const [expanded, setExpanded] = useState(false);

  // 长文本折叠：仅在「回答已结束且超长」时触发；流式进行中始终完整展示。
  const threshold = 900;
  const collapsible = !running && text.length > threshold;

  useEffect(() => {
    if (running) setExpanded(false);
  }, [running]);

  const markdown = (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
      className="aui-md"
      components={markdownComponents}
      componentsByLanguage={askQuestionComponentsByLanguage}
      defer
    />
  );

  if (!collapsible) return markdown;

  return (
    <div className="aui-md-collapse-wrap relative">
      {!expanded && (
        <div className="aui-md-collapse-mask pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
      )}
      <div
        className={cn(
          "aui-md-collapse-body",
          !expanded && "max-h-72 overflow-hidden",
        )}
      >
        {markdown}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="aui-md-collapse-toggle mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80"
      >
        {expanded ? "收起" : `展开全部（${text.length} 字）`}
      </button>
    </div>
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const { t } = useI18n();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="aui-code-header-root border-border/50 bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs">
      <span className="aui-code-header-language text-muted-foreground font-medium lowercase">
        {language}
      </span>
      <TooltipIconButton tooltip={t("copy")} onClick={onCopy}>
        {!isCopied && (
          <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
        )}
        {isCopied && (
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        )}
      </TooltipIconButton>
    </div>
  );
};

const ASK_QUESTION_LANG = "ask-question";

type AskOption = {
  label?: string;
  prompt?: string;
  preferred?: boolean;
};

/**
 * 澄清确认卡片：把 ```ask-question``` 代码块渲染成可点击的「自动发送」选项。
 *
 * 视觉语言对齐项目 token（--dd-*）：单色 + 单一强调、`--dd-r-*` 圆角标尺
 * （卡片 lg 14px / 选项行 md 10px / 序号徽标 sm 8px）、`--dd-shadow-1` 抬升、
 * 顶部 canvas 着色区区分"问题"与"选项"。动效仅做"到达 + 反馈"，尊重 reduced-motion。
 */
function AskQuestionBlock({ json }: { json: string }) {
  const { t } = useI18n();
  const { send } = useComposerControls();

  let question = "";
  let options: AskOption[] = [];
  try {
    const data = JSON.parse(json);
    question = String(data?.question ?? "").trim();
    options = Array.isArray(data?.options) ? data.options : [];
  } catch {
    // 解析失败则回退为普通代码块
  }

  const chips = options.filter((o) => o?.label || o?.prompt);

  const pick = (prompt?: string) => {
    const text = prompt?.trim();
    if (!text) return;
    send?.({ role: "user", content: text });
  };

  // 完全没解析出来：保留原始 JSON 作兜底，避免信息丢失
  if (!chips.length && !question) {
    return (
      <pre className="aui-md-pre my-2 overflow-x-auto rounded-(--dd-r-lg) border border-(--dd-line-strong) bg-(--dd-canvas) p-3.5 text-[13px] leading-relaxed text-(--dd-text-2)">
        {json}
      </pre>
    );
  }

  const header = (
    <div className="flex items-start gap-3 border-b border-(--dd-line) bg-(--dd-canvas) px-4 py-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-(--dd-tint-active) text-(--dd-accent)">
        <CircleHelpIcon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium uppercase tracking-[0.16em] text-(--dd-text-2)">
          {t("clarifyLabel")}
        </span>
        {question && (
          <span className="mt-1 block text-[15px] font-medium leading-snug text-(--dd-text-1)">
            {question}
          </span>
        )}
      </span>
    </div>
  );

  // 有题目但没可选选项：退化为「请直接回复」提示
  if (!chips.length) {
    return (
      <div className="aui-clarification my-2 overflow-hidden rounded-(--dd-r-lg) border border-(--dd-line-strong) bg-(--dd-surface) shadow-(--dd-shadow-1) animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out motion-reduce:animate-none">
        {header}
        <div className="px-4 py-3 text-sm leading-relaxed text-(--dd-text-2)">
          {t("clarifyNoOptions")}
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="aui_ask_question"
      className="aui-clarification my-2 overflow-hidden rounded-(--dd-r-lg) border border-(--dd-line-strong) bg-(--dd-surface) shadow-(--dd-shadow-1) animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out motion-reduce:animate-none"
    >
      {header}

      <div className="flex flex-col gap-1 p-2">
        {chips.map((o, i) => (
          <button
            key={o.prompt ?? o.label ?? i}
            type="button"
            onClick={() => pick(o.prompt ?? o.label)}
            className="group flex w-full items-center justify-between gap-3 rounded-(--dd-r-md) px-2.5 py-2 text-left transition-[background-color,transform] duration-150 ease-out outline-none hover:bg-(--dd-tint-hover) focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--dd-ring) active:scale-[0.98] motion-reduce:transition-none"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-(--dd-r-sm) text-[11px] font-medium tabular-nums transition-colors duration-150 motion-reduce:transition-none",
                  o.preferred
                    ? "border border-(--dd-accent) bg-(--dd-accent) text-(--dd-canvas) group-hover:bg-(--dd-accent-deep)"
                    : "border border-(--dd-line) bg-(--dd-canvas) text-(--dd-text-3) group-hover:border-(--dd-accent) group-hover:text-(--dd-accent)",
                )}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-snug text-(--dd-text-1)">
                  {o.label ?? o.prompt}
                  {o.preferred && (
                    <span className="ml-1.5 rounded-full bg-(--dd-tint-active) px-1.5 py-0.5 align-middle text-[10px] font-medium text-(--dd-accent)">
                      {t("clarifyRecommended")}
                    </span>
                  )}
                </span>
              </span>
            </span>
            <ChevronRightIcon
              className="size-4 shrink-0 text-(--dd-text-3) transition-[transform,color] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-(--dd-accent) motion-reduce:transition-none"
              aria-hidden
            />
          </button>
        ))}
      </div>
    </div>
  );
}

// 对 ```ask-question``` 语言块的完全接管：不渲染代码高亮头部与代码外框，直接渲染可选项 UI。
const askQuestionComponentsByLanguage = {
  [ASK_QUESTION_LANG]: {
    CodeHeader: () => null,
    SyntaxHighlighter: ({ code }: { code?: string }) => (
      <AskQuestionBlock json={String(code ?? "").trim()} />
    ),
  },
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mt-5 mb-2 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-5 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-3.5 mb-1 scroll-m-20 text-base font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "aui-md-h5 mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "aui-md-h6 mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn(
        "aui-md-p my-3 leading-relaxed first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "aui-md-a text-primary hover:text-primary/80 underline underline-offset-2",
        className,
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-3 border-s-2 ps-4",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul marker:text-muted-foreground my-3 ms-5 list-disc [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol marker:text-muted-foreground my-3 ms-5 list-decimal [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("aui-md-hr border-muted-foreground/20 my-3", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="aui-md-table-wrapper my-3 overflow-x-auto">
      <table
        className={cn(
          "aui-md-table w-full border-separate border-spacing-0",
          className,
        )}
        {...props}
      />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-muted-foreground/20 border-s border-b px-3 py-1.5 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr m-0 border-b p-0 first:border-t even:bg-muted/30 [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("aui-md-li leading-relaxed", className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong
      className={cn("aui-md-strong font-semibold", className)}
      {...props}
    />
  ),
  sup: ({ className, ...props }) => (
    <sup
      className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 p-3.5 text-[13px] leading-relaxed",
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "aui-md-inline-code bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});
