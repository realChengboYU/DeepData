// Ant Design 全局主题：对齐 DeepData 中性框架默认（去蓝），随明暗自适应
export const antdThemeFor = (dark) => ({
  token: {
    colorPrimary: dark ? '#e6e8ec' : '#1d1d1f',
    colorInfo: dark ? '#e6e8ec' : '#1d1d1f',
    colorLink: dark ? '#e6e8ec' : '#1d1d1f',
    colorSuccess: '#16a34a',
    colorWarning: '#f59e0b',
    colorError: '#e11d48',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  components: {
    Button: {
      fontWeight: 600,
      primaryShadow: 'none',
    },
  },
})
