"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CopyIcon,
  LoaderIcon,
  TerminalIcon,
  CheckIcon,
  XCircleIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useProcessPanelStore } from "@/store/chat-controls";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useAuiState } from "@assistant-ui/react";
import hljs from "highlight.js/lib/core";
import sql from "highlight.js/lib/languages/sql";
import "./tool-call.css";

hljs.registerLanguage("sql", sql);

type ToolStatus = "running" | "ok" | "error";

type ToolPart = {
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  argsText?: string;
  result?: string | null;
  phase?: string;
  elapsedMs?: number;
  status?: { type?: string };
};

type ThreadGroupPartLike = { indices?: number[] };

/* ---------- 工具判断 ---------- */

function isErrorResult(result: unknown): boolean {
  if (result == null) return false;
  const s = String(result);
  return /工具执行失败|错误|Error|Exception|Traceback|Failed|syntax error|SQL Error/i.test(s);
}

function extractSql(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  const q = a.query ?? a.sql ?? a.statement ?? a.sql_query;
  return typeof q === "string" && q.trim() ? q : null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function highlightSql(code: string): string {
  try {
    return hljs.highlight(code, { language: "sql" }).value;
  } catch {
    try {
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeHtml(code);
    }
  }
}

function toolLabel(
  t: (k: string, v?: Record<string, string | number>) => string,
  name?: string,
  phase?: string,
): string {
  if (name === "sql_db_query") return t("toolSqlQuery");
  if (name === "sql_db_list_tables") return t("toolListTables");
  if (name === "sql_db_schema") return t("toolSchema");
  if (name === "sql_db_query_checker") return t("toolChecker");
  if (name === "render_chart") return t("toolChart");
  if (name === "resolve_time_range") return t("toolTime");
  if (phase === "query") return t("toolSqlQuery");
  if (phase === "chart") return t("toolChart");
  return name || t("toolPanelTitle");
}

/* ---------- 状态图标 ---------- */

function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return (
      <LoaderIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 animate-spin text-(--dd-accent) [animation-duration:0.6s]"
      />
    );
  }
  if (status === "error") {
    return (
      <XCircleIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-[#d70015] dark:text-[#ff7d92]"
      />
    );
  }
  return (
    <CheckCircle2Icon
      aria-hidden="true"
      className="size-3.5 shrink-0 text-[#248a3d] dark:text-[#5ddb8b]"
    />
  );
}

/* ---------- 单条工具调用（紧凑行，非可折叠） ---------- */

function ToolCallRow({
  name,
  args,
  result,
  phase,
  elapsedMs,
  status,
  retry,
}: {
  name?: string;
  args?: unknown;
  result?: string | null;
  phase?: string;
  elapsedMs?: number;
  status?: string;
  retry?: number;
}) {
  const { t } = useI18n();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const sql = extractSql(args);
  const running = status === "running";
  const error = !running && isErrorResult(result);
  const s: ToolStatus = running ? "running" : error ? "error" : "ok";
  const dur = typeof elapsedMs === "number" ? (elapsedMs / 1000).toFixed(1) : null;
  const argsText = args == null ? "" : JSON.stringify(args, null, 2);
  const timeExpr =
    name === "resolve_time_range" && args && typeof args === "object"
      ? String((args as Record<string, unknown>).expression ?? "")
      : "";

  const onCopySql = () => {
    if (!sql || isCopied) return;
    copyToClipboard(sql);
  };

  return (
    <div className="aui-tool-row rounded-lg border border-(--dd-line) bg-(--dd-surface) p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusIcon status={s} />
        <span className="text-sm font-medium text-(--dd-text-1)">{toolLabel(t, name, phase)}</span>
        {dur != null && (
          <span className="text-xs tabular-nums text-(--dd-text-3)">
            {t("toolQueryMs", { s: dur })}
          </span>
        )}
        {running && <span className="text-xs text-(--dd-accent)">{t("toolRunning")}…</span>}
        {retry != null && retry > 0 && (
          <span className="rounded-full bg-(--dd-tint-active) px-1.5 py-0.5 text-[10px] font-medium text-(--dd-accent)">
            {t("retryN", { n: retry + 1 })}
          </span>
        )}
      </div>

      {(sql || argsText) && (
        <div className="mt-2">
          {sql ? (
            <div className="aui-tool-sql overflow-hidden rounded-lg border border-(--dd-line)">
              <div className="flex items-center justify-between gap-2 border-b border-(--dd-line) bg-(--dd-canvas) px-2.5 py-1">
                <span className="text-[10px] uppercase tracking-[0.14em] text-(--dd-text-3)">SQL</span>
                <button
                  type="button"
                  aria-label={t("copySql")}
                  onClick={onCopySql}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-(--dd-text-3) transition-colors hover:bg-(--dd-tint-hover) hover:text-(--dd-text-1) focus-visible:outline-2 focus-visible:outline-(--dd-accent)"
                >
                  {isCopied ? (
                    <CheckIcon aria-hidden="true" className="size-3.5 text-[#248a3d] dark:text-[#5ddb8b]" />
                  ) : (
                    <CopyIcon aria-hidden="true" className="size-3.5" />
                  )}
                  {isCopied ? t("copied") : t("copySql")}
                </button>
              </div>
              <pre className="aui-tool-sql-code">
                <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightSql(sql) }} />
              </pre>
            </div>
          ) : timeExpr ? (
            <>
              <div className="mb-1 text-xs text-(--dd-text-3)">{t("toolArgs")}</div>
              <pre className="aui-tool-pre max-h-24">{timeExpr}</pre>
            </>
          ) : (
            <>
              <div className="mb-1 text-xs text-(--dd-text-3)">{t("toolArgs")}</div>
              <pre className="aui-tool-pre max-h-40">{argsText}</pre>
            </>
          )}
        </div>
      )}

      {result != null && String(result).trim() !== "" && (
        <div className="mt-2">
          <div className="mb-1 text-xs text-(--dd-text-3)">{t("toolResult")}</div>
          <pre className="aui-tool-pre max-h-44">{String(result)}</pre>
        </div>
      )}
    </div>
  );
}

/* ---------- 单个工具调用（独立，可折叠） ---------- */

export function ToolCallBlock({
  name,
  args,
  result,
  phase,
  elapsedMs,
}: {
  name?: string;
  args?: unknown;
  result?: string | null;
  phase?: string;
  elapsedMs?: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const running = result == null;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="tool-call-root"
      className="aui-tool-call-root mb-4 w-full rounded-lg border border-(--dd-line) bg-(--dd-tint-active) px-3 py-2"
    >
      <CollapsibleTrigger
        data-slot="tool-call-trigger"
        className="flex max-w-full items-center gap-2 py-1.5 text-sm text-(--dd-accent) transition-[color,scale] hover:text-(--dd-accent-ink) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--dd-accent)"
      >
        <TerminalIcon data-slot="tool-call-icon" className="size-4 shrink-0" aria-hidden="true" />
        <span className="inline-flex min-w-0 items-center gap-2 truncate leading-none">
          <span className="truncate">{t("toolComponent", { name: toolLabel(t, name, phase) })}</span>
          {running && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-(--dd-accent)/70">
              <StatusIcon status="running" />
              {t("toolRunning")}…
            </span>
          )}
        </span>
        <ChevronDownIcon
          data-slot="tool-call-chevron"
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
            "-rotate-90",
            open && "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent
        data-slot="tool-call-content"
        className="relative overflow-hidden text-sm text-(--dd-text-1) outline-none"
      >
        <div className="pt-2 pb-1">
          <ToolCallRow
            name={name}
            args={args}
            result={result}
            phase={phase}
            elapsedMs={elapsedMs}
            status={running ? "running" : "ok"}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ---------- 分组聚合面板（连续多次工具调用合并为一个） ---------- */

export function ToolCluster({ group }: { group: ThreadGroupPartLike }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const forceOpen = useProcessPanelStore((s) => s.forceOpen);
  const isOpen = forceOpen !== null ? forceOpen : open;

  const parts = useAuiState((s) => s.message.parts);
  const members = useMemo(
    () =>
      (group.indices ?? [])
        .map((i) => parts?.[i])
        .filter((p): p is ToolPart => Boolean(p && p.type === "tool-call")),
    [parts, group.indices],
  );

  const { total, counts, running, error, retries } = useMemo(() => {
    const byName = new Map<string, number>();
    const retryByIndex = new Map<number, number>();
    let running = false;
    let error = false;
    members.forEach((p, idx) => {
      const n = p.toolName ?? "";
      byName.set(n, (byName.get(n) ?? 0) + 1);
      if (p.status?.type === "running") running = true;
      else if (isErrorResult(p.result)) {
        error = true;
        const prev = members.slice(0, idx).filter((q) => q.toolName === n).length;
        retryByIndex.set(idx, prev);
      }
    });
    return { total: members.length, counts: [...byName.entries()], running, error, retries: retryByIndex };
  }, [members]);

  let summary = t("toolPanelTitle");
  if (counts.length === 1) {
    const [name, n] = counts[0];
    if (name === "sql_db_query") summary = t("toolSummaryQuery", { n });
    else if (name === "render_chart") summary = t("toolSummaryChart", { n });
    else if (name === "resolve_time_range") summary = t("toolSummaryTime", { n });
    else summary = t("toolSummaryCalls", { n });
  } else if (counts.length > 1) {
    const tools = counts.map(([name, n]) => t("toolTimes", { name: toolLabel(t, name), n })).join("、");
    summary = t("toolSummaryMixed", { n: total, tools });
  }

  const agg: ToolStatus = running ? "running" : error ? "error" : "ok";

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setOpen}
      data-slot="tool-cluster-root"
      className="aui-tool-cluster-root mb-4 w-full rounded-lg border border-(--dd-line) bg-(--dd-tint-active) px-3 py-2"
    >
      <CollapsibleTrigger
        data-slot="tool-cluster-trigger"
        className="flex w-full items-center gap-2 py-1.5 text-left text-sm transition-[color,scale] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--dd-accent)"
      >
        <TerminalIcon className="size-4 shrink-0 text-(--dd-accent)" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate leading-none">
          <span className="text-(--dd-accent)">{t("toolPanelTitle")}</span>
          <span aria-hidden="true" className="text-(--dd-text-3)">：</span>
          <span className="font-medium text-(--dd-text-1)">{summary}</span>
        </span>
        <StatusIcon status={agg} />
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0 text-(--dd-text-3) transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
            "-rotate-90",
            isOpen && "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent
        data-slot="tool-cluster-content"
        className="relative overflow-hidden text-sm text-(--dd-text-1) outline-none"
      >
        <div className="flex flex-col gap-2 pt-2 pb-1">
          {members.map((p, idx) => (
            <ToolCallRow
              key={p.toolCallId ?? idx}
              name={p.toolName}
              args={p.args}
              result={p.result}
              phase={p.phase}
              elapsedMs={p.elapsedMs}
              status={p.status?.type === "running" ? "running" : "ok"}
              retry={retries.get(idx) ?? 0}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
