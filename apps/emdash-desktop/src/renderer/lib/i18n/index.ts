// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
// react-i18next 配置 — 渐进式中文化（emdash 更新后中文不丢）
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zh, en } from './locales';

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: 'zh', // 默认中文
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React 已处理 XSS
});

// 非 hook 版 t()：组件里 import { t } 直接用（语言切换不自动刷新，默认中文够用）
export const t = i18n.t.bind(i18n);

export default i18n;
