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
const PKG_VERSION = require("../package.json").version as string;
const ARTIFACT_PREFIX = isCanary ? 'emdash-canary' : 'emdash' + "-" + PKG_VERSION;
export const R2_BASE_URL = 'https://releases.emdash.sh';
export const IS_CANARY = isCanary;
