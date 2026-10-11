type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean; VITE_BUILD?: string } };

const env = (import.meta as ImportMetaWithEnv).env;
const isDev = env?.DEV === true;
const isCanary = env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.emdash.canary' : 'com.emdash.stable';
export const PRODUCT_NAME = isCanary ? 'Emdash Canary' : 'Emdash';
export const APP_NAME_LOWER = isCanary ? 'emdash-canary' : 'emdash';
export const LINUX_DESKTOP_ID = isCanary ? 'emdash-canary' : 'Emdash';
export const USER_DATA_DIR_NAME = isDev ? 'emdash-dev' : isCanary ? 'emdash-canary' : 'emdash';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
// [XG-CUSTOM 2026-10-11] 🔴 产物名**必须带版本**：原来只拼前缀 ⇒ 每次产物同名
//   （emdash-x64.exe / emdash-x86_64.AppImage），两个版本从名字上分不出来 —— 用户要求带上。
// [XG-CUSTOM 2026-10-11] 🔴 **修构建**：原来写 `require("../package.json")` —— 那个相对路径指向
//   本文件所在目录（`…/app-identity/package.json`，**不存在**），而且 ESM 构建里根本没有 `require`
//   ⇒ `electron-vite build` 与 `vitest` **双双**报 `Cannot find module '../package.json'`
//   （今天两处都撞上：打包挂掉、node 项目单测全跑不了）。
//   ⇒ 改成**标准 JSON import**（Vite/rollup/vitest/electron-builder 的配置加载器都原生支持），
//     路径 = 从本文件回到 `apps/emdash-desktop/package.json`（上 5 层）。
import pkgJson from '../../../../../package.json';

const PKG_VERSION = ((pkgJson as { version?: string }).version || '0.0.0').trim();
const ARTIFACT_PREFIX = (isCanary ? 'emdash-canary' : 'emdash') + '-' + PKG_VERSION;
export const R2_BASE_URL = 'https://releases.emdash.sh';
export const IS_CANARY = isCanary;
