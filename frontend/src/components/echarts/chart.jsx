import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as echarts from "echarts";
import ReactECharts from "echarts-for-react";
import { westerosTheme } from "@/echarts/westeros";

// 注册一次 westeros 主题（模块级，只跑一次；重复注册无害）
echarts.registerTheme("westeros", westerosTheme);

/**
 * ChartSpec 结构（后端/模型产出）：
 * { chartType: "bar"|"line"|"pie", title, categories, series:[{name,data}], xName, yName, legend, area }
 */
const CHART_TYPES = [
  { key: "bar", label: "柱状图" },
  { key: "line", label: "折线图" },
  { key: "pie", label: "饼图" },
  { key: "scatter", label: "散点图" },
];

// 轻量线性图标（tableau/westeros 数据皮）
function Icon({ children, size = 14, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

const TYPE_ICONS = {
  bar: (
    <Icon>
      <rect x="4" y="11" width="4" height="9" rx="1" />
      <rect x="10" y="6" width="4" height="14" rx="1" />
      <rect x="16" y="13" width="4" height="7" rx="1" />
    </Icon>
  ),
  line: (
    <Icon>
      <path d="M3 17l5-6 4 3 6-8" />
    </Icon>
  ),
  pie: (
    <Icon>
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 12l6.5-6.5" />
    </Icon>
  ),
  scatter: (
    <Icon>
      <circle cx="6" cy="6" r="1.4" fill="currentColor" />
      <circle cx="14" cy="9" r="1.4" fill="currentColor" />
      <circle cx="9" cy="15" r="1.4" fill="currentColor" />
      <circle cx="17" cy="17" r="1.4" fill="currentColor" />
      <circle cx="12" cy="4" r="1.4" fill="currentColor" />
    </Icon>
  ),
};

const ICONS = {
  stack: (
    <Icon>
      <rect x="3" y="14" width="18" height="4" rx="1" />
      <rect x="3" y="7" width="12" height="4" rx="1" />
    </Icon>
  ),
  dual: (
    <Icon>
      <path d="M5 4v16M19 4v16" />
      <path d="M8 9l8 3M8 14l8 3" />
    </Icon>
  ),
  download: (
    <Icon>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </Icon>
  ),
  zoom: (
    <Icon>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
      <path d="M11 8v6M8 11h6" />
    </Icon>
  ),
  collapse: (
    <Icon>
      <path d="M21 15v6h-6" />
      <path d="M3 9V3h6" />
      <path d="M21 21l-7-7" />
      <path d="M3 3l7 7" />
    </Icon>
  ),
  expand: (
    <Icon>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </Icon>
  ),
  close: (
    <Icon>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  ),
};

// 让 westeros 主题负责样式（色板、坐标轴灰标签、扁平柱条、图例/标题颜色），
// 这里只提供结构、布局数据与交互参数，不覆盖主题的颜色/边框。
function buildOption(spec, type, { stacked = false, dual = false } = {}) {
  const categories = spec?.categories ?? [];
  const series = (spec?.series ?? []).filter((s) => s?.data?.length);
  const multiSeries = series.length > 1;

  const base = {
    title: spec?.title ? { text: spec.title, left: "center", top: 4 } : undefined,
    tooltip:
      type === "pie"
        ? { trigger: "item", formatter: "{b}: {c} ({d}%)" }
        : { trigger: "axis", axisPointer: { type: "shadow" } },
    legend:
      spec?.legend !== false && (multiSeries || type === "pie")
        ? { show: true, top: type === "pie" ? 6 : 24, left: "center" }
        : undefined,
    grid: { left: "10%", right: "10%", top: 70, bottom: "8%", containLabel: true },
    color: westerosTheme.color,
  };

  if (type === "pie") {
    const s0 = series[0] ?? { data: [] };
    const data = categories.map((name, i) => ({ name, value: s0.data?.[i] ?? 0 }));
    const showLegend = spec?.legend !== false;
    return {
      ...base,
      // 饼图图例放右侧竖排，避免与顶部标题重叠
      legend: showLegend
        ? {
            orient: "vertical",
            right: 4,
            top: "middle",
            type: "scroll",
            textStyle: { color: "#86868b" },
          }
        : undefined,
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      series: [
        {
          type: "pie",
          radius: showLegend ? ["40%", "60%"] : ["38%", "66%"],
          center: showLegend ? ["42%", "54%"] : ["50%", "56%"],
          data,
          label: { formatter: "{b}\n{d}%", color: "#1d1d1f" },
        },
      ],
    };
  }

  if (type === "scatter") {
    // 分类 x 轴 + 数值 y，把每个分类映射成一个点
    return {
      ...base,
      xAxis: { type: "category", data: categories, name: spec?.xName },
      yAxis: { type: "value", name: spec?.yName },
      series: series.map((s) => ({
        name: s.name,
        type: "scatter",
        data: s.data.map((v, i) => [i, v]),
        symbolSize: 12,
      })),
    };
  }

  const isLine = type === "line";
  const stackOn = stacked && multiSeries ? "total" : undefined;
  const withDual = dual && multiSeries;
  return {
    ...base,
    // 坐标轴只给类型/数据/名称，线色、标签色、刻度、分割线由主题 categoryAxis/valueAxis 提供
    xAxis: { type: "category", data: categories, name: spec?.xName },
    yAxis: withDual
      ? [
          { type: "value", name: spec?.yName },
          { type: "value", splitLine: { show: false } },
        ]
      : { type: "value", name: spec?.yName },
    series: series.map((s, i) => ({
      name: s.name,
      type: isLine ? "line" : "bar",
      data: s.data,
      smooth: isLine,
      barMaxWidth: 44,
      // 多系列（含堆叠/双轴）每系列一个颜色；单系列柱状每根柱子取色板一个颜色
      colorBy: isLine || multiSeries ? "series" : "data",
      stack: stackOn,
      yAxisIndex: withDual && i > 0 ? 1 : 0,
      areaStyle: isLine && spec?.area !== false ? { opacity: 0.18 } : undefined,
    })),
  };
}

export default function Chart({ spec }) {
  const [type, setType] = useState(spec?.chartType || "bar");
  const [stacked, setStacked] = useState(false);
  const [dual, setDual] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // 专注模式：把图单独弹到大弹窗里看
  const [focus, setFocus] = useState(false);
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const focusInstanceRef = useRef(null);

  const series = (spec?.series ?? []).filter((s) => s?.data?.length);
  const multiSeries = series.length > 1;
  const canPie = !multiSeries;
  const chartHeight = 460;

  // 外部 spec.chartType 变化（新图/新消息）时跟随模型建议的类型；用户手动切换后保留
  useEffect(() => {
    if (spec?.chartType) {
      setType(spec.chartType);
      setCollapsed(false);
      setFocus(false);
    }
  }, [spec?.chartType]);

  const option = useMemo(
    () => buildOption(spec, type, { stacked, dual }),
    [spec, type, stacked, dual]
  );

  // 专注弹窗：Esc 关闭 + 锁滚动
  useEffect(() => {
    if (!focus) return;
    const onKey = (e) => {
      if (e.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [focus]);

  const download = () => {
    // 专注模式下用弹窗里的大图例（更清晰），否则用主卡片图例
    const inst = focus ? focusInstanceRef.current : instanceRef.current;
    if (!inst) return;
    const url = inst.getDataURL({ pixelRatio: 2, backgroundColor: "#ffffff" });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec?.title || "chart"}.png`;
    a.click();
  };

  const showXYToggles = type !== "pie" && type !== "scatter";

  // macOS 分段控件：选中段 = 白底浮起；焦点环 = accent
  const typeBtn = (active, disabled) =>
    `inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/40 ${
      active
        ? "bg-white text-[#1d1d1f] shadow-sm"
        : "text-[#86868b] hover:text-[#1d1d1f]"
    } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`;

  // 堆叠/双轴这类开关式小按钮（选中 = accent 蓝态）
  const toggleBtn = (active, disabled) =>
    `inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/40 ${
      active
        ? "border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]"
        : "border-[#e8edf4] bg-white text-[#86868b] hover:border-[#d8e0ea] hover:text-[#48484a]"
    } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`;

  // 右上角的纯图标操作按钮（导出 / 放大 / 收缩 / 关闭）
  const iconBtn = (active, disabled = false) =>
    `inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/40 ${
      active
        ? "border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]"
        : "border-transparent text-[#86868b] hover:bg-[#f4f7fb] hover:text-[#48484a]"
    } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`;

  return (
    <>
      <div
        data-slot="aui_chart"
        className="my-2 overflow-hidden rounded-xl border border-[#e8edf4] bg-white"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eef2f7] bg-[#fbfcfe] px-3 py-2">
          {!collapsed && (
            <>
              {/* 图表类型分段控件 */}
              <div className="inline-flex items-center rounded-lg bg-[#eceff4] p-0.5">
                {CHART_TYPES.map((t) => {
                  const disabled = t.key === "pie" && !canPie;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => setType(t.key)}
                      className={typeBtn(type === t.key, disabled)}
                    >
                      {TYPE_ICONS[t.key]}
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 堆叠 / 双轴 */}
              {showXYToggles && (
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!multiSeries}
                    onClick={() => setStacked((v) => !v)}
                    className={toggleBtn(stacked, !multiSeries)}
                  >
                    {ICONS.stack}
                    <span>堆叠</span>
                  </button>
                  <button
                    type="button"
                    disabled={!multiSeries}
                    onClick={() => setDual((v) => !v)}
                    className={toggleBtn(dual, !multiSeries)}
                  >
                    {ICONS.dual}
                    <span>双轴</span>
                  </button>
                </div>
              )}

              <div className="mx-1 hidden h-4 w-px bg-[#e6ebf2] sm:block" />
            </>
          )}

          {collapsed && (
            <span className="min-w-0 flex-1 truncate text-xs text-[#5b6b80]">
              {spec?.title || "图表已收起"}
            </span>
          )}

          {/* 右上角：导出 / 放大 / 收缩 */}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              title="导出 PNG"
              disabled={collapsed}
              onClick={download}
              className={iconBtn(false, collapsed)}
            >
              {ICONS.download}
            </button>
            <button
              type="button"
              title="放大（专注查看）"
              onClick={() => setFocus(true)}
              className={iconBtn(focus)}
            >
              {ICONS.zoom}
            </button>
            <button
              type="button"
              title={collapsed ? "展开" : "收缩"}
              onClick={() => setCollapsed(!collapsed)}
              className={iconBtn(collapsed)}
            >
              {collapsed ? ICONS.expand : ICONS.collapse}
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="p-2">
            <ReactECharts
              ref={chartRef}
              option={option}
              theme="westeros"
              style={{ height: chartHeight, width: "100%" }}
              notMerge
              opts={{ renderer: "canvas" }}
              onChartReady={(inst) => {
                instanceRef.current = inst;
              }}
            />
          </div>
        )}
      </div>

      {/* 专注模式弹窗：用 Portal 挂到 body，脱离聊天条的固定定位/宽度限制 */}
      {focus &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 backdrop-blur-md sm:p-4"
            onClick={() => setFocus(false)}
          >
            <div
              className="flex max-h-[95vh] w-[min(1500px,96vw)] flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_24px_64px_rgba(29,29,31,0.3)]"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex flex-wrap items-center gap-2 border-b border-[#eef2f7] bg-[#fbfcfe] px-3 py-2">
              <span className="min-w-0 truncate text-sm font-medium text-[#1d1d1f]">
                {spec?.title || "图表"}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  title="导出 PNG"
                  onClick={download}
                  className={iconBtn(false)}
                >
                  {ICONS.download}
                </button>
                <button
                  type="button"
                  title="关闭"
                  onClick={() => setFocus(false)}
                  className={iconBtn(false)}
                >
                  {ICONS.close}
                </button>
              </div>
            </div>
            <div className="flex-1 p-2">
              <ReactECharts
                option={option}
                theme="westeros"
                style={{ height: "78vh", width: "100%" }}
                notMerge
                opts={{ renderer: "canvas" }}
                onChartReady={(inst) => {
                  focusInstanceRef.current = inst;
                }}
              />
            </div>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}
