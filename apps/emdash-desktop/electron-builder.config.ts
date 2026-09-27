import type { Configuration } from 'electron-builder';
import {
  APP_ID,
  ARTIFACT_PREFIX,
  LINUX_DESKTOP_ID,
  PRODUCT_NAME,
  R2_BASE_URL,
  UPDATE_CHANNEL,
} from './src/core/primitives/app-identity/api/app-identity.ts';

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  executableName: PRODUCT_NAME,
  extraMetadata: { desktopName: `${LINUX_DESKTOP_ID}.desktop` },
  directories: { output: 'release' },
  artifactName: `${ARTIFACT_PREFIX}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'github',
      owner: 'generalaction',
      repo: 'emdash',
      releaseType: 'draft',
    },
    {
      provider: 'generic',
      url: R2_BASE_URL,
      channel: UPDATE_CHANNEL,
    },
  ],
  generateUpdatesFilesForAllChannels: false,
  files: [
    'out/**/*',
    // [XG-CUSTOM] 精确收集 emdash-desktop 的直接依赖（electron-builder 在 pnpm workspace 下
    // 对这些包报 "cannot find path for dependency ...@undefined"，漏进顶层 node_modules，
    // 运行时顶层 require 报 Cannot find package）。逐个 from/to 收集，避免全量 node_modules 过大。
    { from: '../../node_modules/@agentclientprotocol/sdk', to: 'node_modules/@agentclientprotocol/sdk' },
    { from: '../../node_modules/@fontsource-variable/inter', to: 'node_modules/@fontsource-variable/inter' },
    { from: '../../node_modules/@fontsource-variable/jetbrains-mono', to: 'node_modules/@fontsource-variable/jetbrains-mono' },
    { from: '../../node_modules/@gitbeaker/rest', to: 'node_modules/@gitbeaker/rest' },
    { from: '../../node_modules/@linear/sdk', to: 'node_modules/@linear/sdk' },
    { from: '../../node_modules/@llamaduck/forgejo-ts', to: 'node_modules/@llamaduck/forgejo-ts' },
    { from: '../../node_modules/@octokit/auth-oauth-device', to: 'node_modules/@octokit/auth-oauth-device' },
    { from: '../../node_modules/@octokit/rest', to: 'node_modules/@octokit/rest' },
    { from: '../../node_modules/@parcel/watcher', to: 'node_modules/@parcel/watcher' },
    { from: '../../node_modules/@team-plain/graphql', to: 'node_modules/@team-plain/graphql' },
    { from: '../../node_modules/@typescript/native-preview', to: 'node_modules/@typescript/native-preview' },
    { from: '../../node_modules/better-sqlite3', to: 'node_modules/better-sqlite3' },
    { from: '../../node_modules/croner', to: 'node_modules/croner' },
    { from: '../../node_modules/cronstrue', to: 'node_modules/cronstrue' },
    { from: '../../node_modules/drizzle-orm', to: 'node_modules/drizzle-orm' },
    { from: '../../node_modules/i18next', to: 'node_modules/i18next' },
    { from: '../../node_modules/jsonc-parser', to: 'node_modules/jsonc-parser' },
    { from: '../../node_modules/node-pty', to: 'node_modules/node-pty' },
    { from: '../../node_modules/pidusage', to: 'node_modules/pidusage' },
    { from: '../../node_modules/react-i18next', to: 'node_modules/react-i18next' },
    { from: '../../node_modules/smol-toml', to: 'node_modules/smol-toml' },
    { from: '../../node_modules/socks-proxy-agent', to: 'node_modules/socks-proxy-agent' },
    { from: '../../node_modules/ssh2', to: 'node_modules/ssh2' },
    { from: '../../node_modules/tinykeys', to: 'node_modules/tinykeys' },
    { from: '../../node_modules/ts-pattern', to: 'node_modules/ts-pattern' },
    { from: '../../node_modules/zod', to: 'node_modules/zod' },
    'drizzle/**/*',
  ],
  asarUnpack: [
    'out/main/adapters/**',
    'node_modules/better-sqlite3/**',
    'node_modules/node-pty/**',
    'node_modules/@parcel/watcher/**',
    '**/*.node',
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Emdash needs microphone access for voice dictation and voice mode features.',
      NSLocalNetworkUsageDescription:
        'Emdash needs local network access to connect to SSH hosts on your network.',
    },
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    icon: 'src/assets/images/emdash/emdash.icns',
    notarize: false,
  },
  dmg: {
    icon: 'src/assets/images/emdash/emdash.icns',
    background: 'build/dmg-background.tiff',
    window: { width: 530, height: 319 },
    contents: [
      { x: 132, y: 150, type: 'file' },
      { x: 398, y: 150, type: 'link', path: '/Applications' },
    ],
  },
  linux: {
    category: 'Development',
    icon: 'src/assets/images/emdash/emdash.png',
    syncDesktopName: true,
    desktop: {
      entry: { StartupWMClass: PRODUCT_NAME },
    },
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
  },
  win: {
    icon: 'src/assets/images/emdash/emdash.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'msi', arch: ['x64'] },
    ],
    // [XG-CUSTOM] 去掉 azureSignOptions：fork 无 Azure 凭据，签名会卡 6h 超时，打 unsigned 包
  },
  msi: {
    oneClick: false,
    perMachine: false,
  },
  nsis: {
    differentialPackage: true,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
  },
  npmRebuild: false,
  // Encrypt Chromium's on-disk cookie store (in-app browser logins) with OS-level
  // keys, like Chrome does. One-way: never disable once shipped or existing
  // cookie stores become unreadable.
  electronFuses: {
    enableCookieEncryption: true,
  },
};

export default config;
