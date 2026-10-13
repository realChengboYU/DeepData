// ECharts 图表主题（Apple 数据可视化语言），亮/暗双主题。
// 颜色、文字与坐标轴全部对齐 index.css 里的 --dd-* 设计令牌（亮/暗各一组），
// 这样图表在浅色/深色模式下与整站材质完全一致，不再出现"暗色下图表发亮"的问题。
// 用法：import { westerosLightTheme, westerosDarkTheme, westerosTokens } from "@/echarts/westeros";
//       echarts.registerTheme("westerosLight", westerosLightTheme);
//       echarts.registerTheme("westerosDark", westerosDarkTheme);

// 分类色板：品牌蓝打头（亮 = --dd-accent，暗 = --dd-accent 深色变亮），
// 同色族在暗色下整体提亮，保证深色画布上可读。
const PALETTE = {
  light: ["#2563eb", "#5e5ce6", "#00c7be", "#ff9f0a", "#ff375f", "#34c759"],
  dark: ["#4f8cff", "#7d7bff", "#14d8c8", "#ffb340", "#ff5c7a", "#43d97d"],
};

// 与 index.css 的 --dd-* 令牌一一对应（亮/暗各一组）
const TOKEN = {
  light: {
    text: "#1d1d1f",        // --dd-text-1
    text2: "#48484a",       // --dd-text-2
    text3: "#86868b",       // --dd-text-3
    axisLine: "#d8e0ea",    // --dd-line-strong
    splitLine: "#f0f2f6",   // 网格发丝线（略深于画布）
    tooltipBg: "#ffffff",
    tooltipBorder: "#e8edf4", // --dd-line
    mapArea: "#f5f7fa",
    mapEmphasis: "#dbeafe",
  },
  dark: {
    text: "#f2f3f5",        // --dd-text-1
    text2: "#b9bdc6",       // --dd-text-2
    text3: "#7d828c",       // --dd-text-3
    axisLine: "#343841",    // --dd-line-strong
    splitLine: "#22262d",   // 网格发丝线（暗色表面上的极微弱线）
    tooltipBg: "#1f232a",
    tooltipBorder: "#31353d",
    mapArea: "#1b2130",
    mapEmphasis: "#1c2a45",
  },
};

/**
 * 生成某一种模式（"light" | "dark"）下的完整 ECharts 主题对象。
 * 不依赖 DOM，纯对象，可安全地在模块加载期与组件渲染期调用。
 */
export function makeWesterosTheme(mode) {
  const p = PALETTE[mode === "dark" ? "dark" : "light"];
  const t = TOKEN[mode === "dark" ? "dark" : "light"];

  const axis = {
    axisLine: { show: true, lineStyle: { color: t.axisLine } },
    axisTick: { show: false, lineStyle: { color: t.text3 } },
    axisLabel: { show: true, color: t.text3 },
    splitLine: { show: true, lineStyle: { color: [t.splitLine] } },
    splitArea: {
      show: false,
      areaStyle: {
        color: [mode === "dark" ? "rgba(255,255,255,0.02)" : "rgba(250,250,250,0.05)", "rgba(200,200,200,0.02)"],
      },
    },
  };

  const tooltip = {
    backgroundColor: t.tooltipBg,
    borderColor: t.tooltipBorder,
    borderWidth: 1,
    textStyle: { color: t.text },
    extraCssText: "box-shadow: 0 8px 28px rgba(29,29,31,.12); border-radius: 10px;",
    axisPointer: {
      lineStyle: { color: t.axisLine, width: 1 },
      crossStyle: { color: t.axisLine, width: 1 },
    },
  };

  return {
    color: p,
    backgroundColor: "rgba(0,0,0,0)",
    textStyle: {
      fontFamily: "'Geist Variable', system-ui, -apple-system, sans-serif",
    },
    title: {
      textStyle: { color: t.text, fontWeight: 600 },
      subtextStyle: { color: t.text3 },
    },
    line: {
      itemStyle: { borderWidth: "2" },
      lineStyle: { width: "2" },
      symbolSize: "5",
      symbol: "emptyCircle",
      smooth: true,
    },
    radar: {
      itemStyle: { borderWidth: "2" },
      lineStyle: { width: "2" },
      symbolSize: "5",
      symbol: "emptyCircle",
      smooth: true,
    },
    bar: {
      itemStyle: {
        barBorderWidth: 0,
        barBorderColor: t.splitLine,
        borderRadius: [3, 3, 0, 0],
      },
    },
    pie: { itemStyle: { borderWidth: 0, borderColor: t.splitLine } },
    scatter: { itemStyle: { borderWidth: 0, borderColor: t.splitLine } },
    boxplot: { itemStyle: { borderWidth: 0, borderColor: t.splitLine } },
    parallel: { itemStyle: { borderWidth: 0, borderColor: t.splitLine } },
    sankey: { itemStyle: { borderWidth: 0, borderColor: t.splitLine } },
    funnel: { itemStyle: { borderWidth: 0, borderColor: t.splitLine } },
    gauge: { itemStyle: { borderWidth: 0, borderColor: t.splitLine } },
    candlestick: {
      itemStyle: {
        color: "#ff375f",
        color0: "transparent",
        borderColor: "#ff375f",
        borderColor0: "#00c7be",
        borderWidth: "2",
      },
    },
    graph: {
      itemStyle: { borderWidth: 0, borderColor: t.splitLine },
      lineStyle: { width: 1, color: t.axisLine },
      symbolSize: "6",
      symbol: "emptyCircle",
      smooth: true,
      color: p,
      label: { color: t.text2 },
    },
    map: {
      itemStyle: { areaColor: t.mapArea, borderColor: p[0], borderWidth: 0.5 },
      label: { color: t.text },
      emphasis: {
        itemStyle: { areaColor: t.mapEmphasis, borderColor: p[0], borderWidth: 1 },
        label: { color: p[0] },
      },
    },
    geo: {
      itemStyle: { areaColor: t.mapArea, borderColor: p[0], borderWidth: 0.5 },
      label: { color: t.text },
      emphasis: {
        itemStyle: { areaColor: t.mapEmphasis, borderColor: p[0], borderWidth: 1 },
        label: { color: p[0] },
      },
    },
    categoryAxis: axis,
    valueAxis: axis,
    logAxis: axis,
    timeAxis: axis,
    toolbox: {
      iconStyle: { borderColor: t.text3 },
      emphasis: { iconStyle: { borderColor: t.text2 } },
    },
    legend: {
      textStyle: { color: t.text3 },
      left: "center",
      right: "auto",
      top: 0,
      bottom: 10,
    },
    tooltip,
    timeline: {
      lineStyle: { color: p[2], width: 1 },
      itemStyle: { color: p[2], borderWidth: 1 },
      controlStyle: { color: p[2], borderColor: p[2], borderWidth: 0.5 },
      checkpointStyle: { color: p[2], borderColor: "rgba(138,124,168,0.37)" },
      label: { color: p[2] },
      emphasis: {
        itemStyle: { color: p[2] },
        controlStyle: { color: p[2], borderColor: p[2], borderWidth: 0.5 },
        label: { color: p[2] },
      },
    },
    visualMap: { color: [p[0], p[2], "#93c5fd"] },
    markPoint: {
      label: { color: t.text },
      emphasis: { label: { color: t.text } },
    },
    grid: { left: "10%", right: "10%", top: 60, bottom: 70 },
  };
}

export const westerosLightTheme = makeWesterosTheme("light");
export const westerosDarkTheme = makeWesterosTheme("dark");

// 兼容旧引用（默认对齐浅色主题）
export const westerosTheme = westerosLightTheme;

/**
 * 供 option 内少量需要显式配色的地方使用（饼图标签、饼图图例文字颜色等）。
 */
export function westerosTokens(mode) {
  const t = TOKEN[mode === "dark" ? "dark" : "light"];
  return { text: t.text, text3: t.text3 };
}
