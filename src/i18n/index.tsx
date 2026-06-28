// 文件路径：src/i18n/index.ts
// 文件作用：轻量国际化（i18n）——中英文词典 + Context + useT hook，无新依赖(#93)
// 最后更新时间：2026-06-29-0130

import { createContext, useContext, useState, type ReactNode } from 'react';

/// 支持的语言
export type Lang = 'zh' | 'en';

/// 词典键集合（核心导航与常用按钮，可逐步扩展）
const DICT: Record<Lang, Record<string, string>> = {
  zh: {
    // 导航
    'nav.develop': '开发',
    'nav.devices': '设备',
    'nav.projects': '项目',
    'nav.monitor': '串口监控',
    'nav.settings': '设置',
    'nav.help': '帮助',
    // 通用按钮
    'btn.run': '🚀 一键全自动开发',
    'btn.stop': '⏹ 终止',
    'btn.chat': '与 AI 对话澄清',
    'btn.save': '💾 保存设置',
    'btn.reset': '↺ 重置',
    'btn.refresh': '🔄 刷新',
    // 开发视图
    'dev.device': '设备',
    'dev.chip': '芯片',
    'dev.requirement': '需求',
    'dev.llmNotConfigured': '尚未配置 LLM，无法进行 AI 开发。',
    'dev.goSettings': '前往设置 →',
    // 头部
    'header.subtitle': '自然语言驱动的 ESP32 全自动开发',
    // 状态
    'state.idle': '空闲',
    'state.running': '运行中',
  },
  en: {
    'nav.develop': 'Develop',
    'nav.devices': 'Devices',
    'nav.projects': 'Projects',
    'nav.monitor': 'Monitor',
    'nav.settings': 'Settings',
    'nav.help': 'Help',
    'btn.run': '🚀 Auto Develop',
    'btn.stop': '⏹ Stop',
    'btn.chat': 'Chat with AI',
    'btn.save': '💾 Save',
    'btn.reset': '↺ Reset',
    'btn.refresh': '🔄 Refresh',
    'dev.device': 'Device',
    'dev.chip': 'Chip',
    'dev.requirement': 'Requirement',
    'dev.llmNotConfigured': 'LLM not configured. AI development unavailable.',
    'dev.goSettings': 'Go to Settings →',
    'header.subtitle': 'Natural-language driven ESP32 auto development',
    'state.idle': 'Idle',
    'state.running': 'Running',
  },
};

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'zh',
  setLang: () => {},
  t: (key) => DICT.zh[key] ?? key,
});

/// i18n Provider：语言持久化到 localStorage
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('talk2esp-lang');
    return saved === 'en' ? 'en' : 'zh';
  });
  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('talk2esp-lang', l);
  };
  const t = (key: string) => DICT[lang][key] ?? DICT.zh[key] ?? key;
  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

/// useT hook：获取翻译函数
export function useI18n() {
  return useContext(I18nContext);
}
