// ECharts 默认图表主题（原 westeros，已校准为 Apple 数据可视化语言）：
// 色板 = Apple 系统 categorical 色（品牌蓝打头），坐标轴 = 发丝线灰，
// 文字 = Apple 墨色/次级灰，柱顶圆角，Geist 字体。
// 用法：import { westerosTheme } from "@/echarts/westeros"; echarts.registerTheme("westeros", westerosTheme);
export const westerosTheme = {
  color: ["#2563eb", "#5e5ce6", "#00c7be", "#ff9f0a", "#ff375f", "#34c759"],
  backgroundColor: "rgba(0,0,0,0)",
  textStyle: {
    fontFamily: "'Geist Variable', system-ui, -apple-system, sans-serif",
  },
  title: {
    textStyle: { color: "#1d1d1f", fontWeight: 600 },
    subtextStyle: { color: "#86868b" },
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
    itemStyle: { barBorderWidth: 0, barBorderColor: "#ccc", borderRadius: [3, 3, 0, 0] },
  },
  pie: {
    itemStyle: { borderWidth: 0, borderColor: "#ccc" },
  },
  scatter: {
    itemStyle: { borderWidth: 0, borderColor: "#ccc" },
  },
  boxplot: {
    itemStyle: { borderWidth: 0, borderColor: "#ccc" },
  },
  parallel: {
    itemStyle: { borderWidth: 0, borderColor: "#ccc" },
  },
  sankey: {
    itemStyle: { borderWidth: 0, borderColor: "#ccc" },
  },
  funnel: {
    itemStyle: { borderWidth: 0, borderColor: "#ccc" },
  },
  gauge: {
    itemStyle: { borderWidth: 0, borderColor: "#ccc" },
  },
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
    itemStyle: { borderWidth: 0, borderColor: "#ccc" },
    lineStyle: { width: 1, color: "#d8e0ea" },
    symbolSize: "6",
    symbol: "emptyCircle",
    smooth: true,
    color: ["#2563eb", "#5e5ce6", "#00c7be", "#ff9f0a", "#ff375f", "#34c759"],
    label: { color: "#48484a" },
  },
  map: {
    itemStyle: { areaColor: "#f5f7fa", borderColor: "#2563eb", borderWidth: 0.5 },
    label: { color: "#000" },
    emphasis: {
      itemStyle: { areaColor: "#dbeafe", borderColor: "#2563eb", borderWidth: 1 },
      label: { color: "#2563eb" },
    },
  },
  geo: {
    itemStyle: { areaColor: "#f5f7fa", borderColor: "#2563eb", borderWidth: 0.5 },
    label: { color: "#000" },
    emphasis: {
      itemStyle: { areaColor: "#dbeafe", borderColor: "#2563eb", borderWidth: 1 },
      label: { color: "#2563eb" },
    },
  },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: "#d8e0ea" } },
    axisTick: { show: false, lineStyle: { color: "#333" } },
    axisLabel: { show: true, color: "#86868b" },
    splitLine: { show: true, lineStyle: { color: ["#f0f2f6"] } },
    splitArea: { show: false, areaStyle: { color: ["rgba(250,250,250,0.05)", "rgba(200,200,200,0.02)"] } },
  },
  valueAxis: {
    axisLine: { show: true, lineStyle: { color: "#d8e0ea" } },
    axisTick: { show: false, lineStyle: { color: "#333" } },
    axisLabel: { show: true, color: "#86868b" },
    splitLine: { show: true, lineStyle: { color: ["#f0f2f6"] } },
    splitArea: { show: false, areaStyle: { color: ["rgba(250,250,250,0.05)", "rgba(200,200,200,0.02)"] } },
  },
  logAxis: {
    axisLine: { show: true, lineStyle: { color: "#d8e0ea" } },
    axisTick: { show: false, lineStyle: { color: "#333" } },
    axisLabel: { show: true, color: "#86868b" },
    splitLine: { show: true, lineStyle: { color: ["#f0f2f6"] } },
    splitArea: { show: false, areaStyle: { color: ["rgba(250,250,250,0.05)", "rgba(200,200,200,0.02)"] } },
  },
  timeAxis: {
    axisLine: { show: true, lineStyle: { color: "#d8e0ea" } },
    axisTick: { show: false, lineStyle: { color: "#333" } },
    axisLabel: { show: true, color: "#86868b" },
    splitLine: { show: true, lineStyle: { color: ["#f0f2f6"] } },
    splitArea: { show: false, areaStyle: { color: ["rgba(250,250,250,0.05)", "rgba(200,200,200,0.02)"] } },
  },
  toolbox: {
    iconStyle: { borderColor: "#999" },
    emphasis: { iconStyle: { borderColor: "#666" } },
  },
  legend: {
    textStyle: { color: "#86868b" },
    left: "center",
    right: "auto",
    top: 0,
    bottom: 10,
  },
  tooltip: {
    axisPointer: {
      lineStyle: { color: "#d8e0ea", width: 1 },
      crossStyle: { color: "#d8e0ea", width: 1 },
    },
  },
  timeline: {
    lineStyle: { color: "#8fd3e8", width: 1 },
    itemStyle: { color: "#8fd3e8", borderWidth: 1 },
    controlStyle: { color: "#8fd3e8", borderColor: "#8fd3e8", borderWidth: 0.5 },
    checkpointStyle: { color: "#8fd3e8", borderColor: "rgba(138,124,168,0.37)" },
    label: { color: "#8fd3e8" },
    emphasis: {
      itemStyle: { color: "#8fd3e8" },
      controlStyle: { color: "#8fd3e8", borderColor: "#8fd3e8", borderWidth: 0.5 },
      label: { color: "#8fd3e8" },
    },
  },
  visualMap: { color: ["#2563eb", "#00c7be", "#93c5fd"] },
  markPoint: {
    label: { color: "#1d1d1f" },
    emphasis: { label: { color: "#1d1d1f" } },
  },
  grid: { left: "10%", right: "10%", top: 60, bottom: 70 },
};
