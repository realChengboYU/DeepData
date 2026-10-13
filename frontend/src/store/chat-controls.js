import { create } from "zustand";

/**
 * 全局面板控制：是否强制展开/折叠所有「思考过程/工具调用」折叠面板。
 * - `forceOpen === null`：跟随各面板自己的默认态（流媒体自动撑开）。
 * - `forceOpen === true`：一键全部展开。
 * - `forceOpen === false`：一键全部折叠。
 */
export const useProcessPanelStore = create((set, get) => ({
  forceOpen: null,
  expandAll: () => set({ forceOpen: true }),
  collapseAll: () => set({ forceOpen: false }),
  toggleAll: () => set({ forceOpen: get().forceOpen === true ? false : true }),
  reset: () => set({ forceOpen: null }),
}));
