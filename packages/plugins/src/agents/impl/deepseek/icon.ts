// [XG-CUSTOM 2026-10-26] DeepSeek 图标（自绘示意，非官方 logo）—— 台账见 emdash/scripts/xg-custom/manifest.json
import type { PluginIconAsset } from '@emdash/shared/plugins';

export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'DeepSeek',
  variants: [
    {
      minSize: 0,
      light: `<svg height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>DeepSeek</title><path d="M12 3c4.4 0 8 3 8 6.9 0 3.4-2.4 6.1-5.7 6.7-.4.1-.6.3-.6.7v1.9c0 .9-.7 1.6-1.6 1.6h-.2c-.9 0-1.6-.7-1.6-1.6v-1.9c0-.4-.2-.6-.6-.7C6.4 16 4 13.3 4 9.9 4 6 7.6 3 12 3zm-2.6 5.4a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm5.2 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z" fill="currentColor"/><path d="M10 13.4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    },
  ],
};