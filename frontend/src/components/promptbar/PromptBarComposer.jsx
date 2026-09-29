import { useAuiState } from '@assistant-ui/react';
import { useCallback } from 'react';
import { Calendar, ChartLine, FileText, Globe, Mail } from 'lucide-react';
import PromptBar from './PromptBar';
import { useComposerControls } from './controls';
import { useModelsStore } from '../../store/models';

// 平台主题色（DeepData 蓝调）
const THEME = {
  background: '#eff6ff', // 浅蓝雾面（输入框表面）
  color: '#1e3a8a', // 深蓝墨水（文字/图标）
  menuBackground: '#ffffff', // 下拉菜单表面
  sparkColor: '#2563eb', // 主色蓝（火花/高亮/滑杆）
};

// 数据问答平台菜单项（不含附件 attach，避免死按钮）
const SOURCES = [
  { key: 'web', name: 'Web search', description: 'Live results', icon: Globe },
  { key: 'sales', name: 'Sales data', description: 'Revenue and churn', icon: ChartLine },
  { key: 'docs', name: 'Documents', description: 'Specs, notes, briefs', icon: FileText },
  { key: 'mail', name: 'Mail', description: 'Read and draft mail', icon: Mail },
  { key: 'calendar', name: 'Calendar', description: 'Events and availability', icon: Calendar },
];

const COMMANDS = [
  { key: 'summarize', name: '/summarize', description: 'Digest the thread so far' },
  { key: 'compare', name: '/compare', description: 'Two options side by side' },
  { key: 'draft', name: '/draft', description: 'Write a first version' },
  { key: 'explain', name: '/explain', description: 'A plain-language walkthrough' },
  { key: 'tasks', name: '/tasks', description: 'Turn this into a to-do list' },
];

export function PromptBarComposer() {
  const { onStop, send, composerRef } = useComposerControls();
  // 是否正在生成回复：驱动「发送 → 停止」的箭头变形
  const busy = useAuiState((s) => s.thread.isRunning);
  // 模型选择器：真实数据来自「设置 → 模型配置」（多模型 store，选中项持久化）
  const models = useModelsStore((s) => s.models);
  const selectedId = useModelsStore((s) => s.selectedId);

  const handleSend = useCallback(
    (text, opts) => {
      const t = (text || '').trim();
      if (!t) return;
      // 把输入框当前选中的模型同步到全局 store，随后请求会携带 modelId
      const key = opts?.model?.key;
      if (key) useModelsStore.getState().select(key);
      // 走 Chat 里 assistant-ui 外部 store 的 onNew 流程（含会话隔离 + 流式输出）
      send?.({ role: 'user', content: t });
    },
    [send],
  );

  return (
    <div className="prompt-bar-composer">
      <PromptBar
        placeholder="有问题随时问我…"
        sources={SOURCES}
        commands={COMMANDS}
        models={models.map((m) => ({
          key: m.id,
          name: m.name,
          tag: m.is_default ? '默认' : m.model || '自定义',
        }))}
        defaultModel={selectedId}
        efforts={[]}
        busy={busy}
        onSend={handleSend}
        onStop={onStop}
        composerRef={composerRef}
        background={THEME.background}
        color={THEME.color}
        menuBackground={THEME.menuBackground}
        sparkColor={THEME.sparkColor}
        width={704}
        radius={18}
        maxRows={5}
      />
    </div>
  );
}

export default PromptBarComposer;
