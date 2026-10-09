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
    // [XG-CUSTOM 2026-10-09] 本机（Linux）打 Windows 包时依赖树遍历**收不到**它，而
    //   `out/main/chunks/*.js` 运行时会 `require('https-proxy-agent')` ⇒ 代理路径会抛错。
    //   CI（Windows runner 上装依赖）能收到，本地打必须显式补一条（与既有清单同风格）。
    { from: '../../node_modules/https-proxy-agent', to: 'node_modules/https-proxy-agent' },
    { from: '../../node_modules/axios', to: 'node_modules/axios' },
    { from: '../../node_modules/@octokit/auth-oauth-device', to: 'node_modules/@octokit/auth-oauth-device' },
    { from: '../../node_modules/@octokit/oauth-methods', to: 'node_modules/@octokit/oauth-methods' },
    { from: '../../node_modules/@octokit/request', to: 'node_modules/@octokit/request' },
    { from: '../../node_modules/@octokit/types', to: 'node_modules/@octokit/types' },
    { from: '../../node_modules/@octokit/rest', to: 'node_modules/@octokit/rest' },
    // [XG-CUSTOM 2026-10-02] @octokit/rest 的传递依赖（缺 @octokit/core 会导致启动失败：
    //   Error: Cannot find package '@octokit/core' imported from .../app.asar）
    { from: '../../node_modules/@octokit/core', to: 'node_modules/@octokit/core' },
    { from: '../../node_modules/@octokit/auth-token', to: 'node_modules/@octokit/auth-token' },
    { from: '../../node_modules/@octokit/graphql', to: 'node_modules/@octokit/graphql' },
    { from: '../../node_modules/@octokit/endpoint', to: 'node_modules/@octokit/endpoint' },
    { from: '../../node_modules/@octokit/request-error', to: 'node_modules/@octokit/request-error' },
    { from: '../../node_modules/@octokit/oauth-authorization-url', to: 'node_modules/@octokit/oauth-authorization-url' },
    { from: '../../node_modules/@octokit/plugin-paginate-rest', to: 'node_modules/@octokit/plugin-paginate-rest' },
    { from: '../../node_modules/@octokit/plugin-request-log', to: 'node_modules/@octokit/plugin-request-log' },
    { from: '../../node_modules/@octokit/plugin-rest-endpoint-methods', to: 'node_modules/@octokit/plugin-rest-endpoint-methods' },
    { from: '../../node_modules/before-after-hook', to: 'node_modules/before-after-hook' },
    { from: '../../node_modules/content-type', to: 'node_modules/content-type' },
    { from: '../../node_modules/json-with-bigint', to: 'node_modules/json-with-bigint' },
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
    { from: '../../node_modules/universal-user-agent', to: 'node_modules/universal-user-agent' },
    { from: '../../node_modules/zod', to: 'node_modules/zod' },
    { from: '../../node_modules/electron-updater', to: 'node_modules/electron-updater' },
    { from: '../../node_modules/human-id', to: 'node_modules/human-id' },
    { from: '../../node_modules/nbranch', to: 'node_modules/nbranch' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/@babel/runtime', to: 'node_modules/@babel/runtime' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/@gitbeaker/core', to: 'node_modules/@gitbeaker/core' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/@gitbeaker/requester-utils', to: 'node_modules/@gitbeaker/requester-utils' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/@graphql-typed-document-node/core', to: 'node_modules/@graphql-typed-document-node/core' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/@octokit/openapi-types', to: 'node_modules/@octokit/openapi-types' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/@types/stopword', to: 'node_modules/@types/stopword' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/agent-base', to: 'node_modules/agent-base' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/argparse', to: 'node_modules/argparse' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/asn1', to: 'node_modules/asn1' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/asynckit', to: 'node_modules/asynckit' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/base64-js', to: 'node_modules/base64-js' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/bcrypt-pbkdf', to: 'node_modules/bcrypt-pbkdf' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/bindings', to: 'node_modules/bindings' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/bl', to: 'node_modules/bl' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/buffer', to: 'node_modules/buffer' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/builder-util-runtime', to: 'node_modules/builder-util-runtime' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/call-bind-apply-helpers', to: 'node_modules/call-bind-apply-helpers' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/call-bound', to: 'node_modules/call-bound' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/chownr', to: 'node_modules/chownr' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/combined-stream', to: 'node_modules/combined-stream' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/compromise', to: 'node_modules/compromise' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/debug', to: 'node_modules/debug' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/decompress-response', to: 'node_modules/decompress-response' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/deep-extend', to: 'node_modules/deep-extend' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/delayed-stream', to: 'node_modules/delayed-stream' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/detect-libc', to: 'node_modules/detect-libc' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/dunder-proto', to: 'node_modules/dunder-proto' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/efrt', to: 'node_modules/efrt' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/end-of-stream', to: 'node_modules/end-of-stream' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/es-define-property', to: 'node_modules/es-define-property' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/es-errors', to: 'node_modules/es-errors' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/es-object-atoms', to: 'node_modules/es-object-atoms' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/es-set-tostringtag', to: 'node_modules/es-set-tostringtag' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/expand-template', to: 'node_modules/expand-template' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/file-uri-to-path', to: 'node_modules/file-uri-to-path' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/follow-redirects', to: 'node_modules/follow-redirects' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/form-data', to: 'node_modules/form-data' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/fs-constants', to: 'node_modules/fs-constants' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/fs-extra', to: 'node_modules/fs-extra' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/function-bind', to: 'node_modules/function-bind' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/get-intrinsic', to: 'node_modules/get-intrinsic' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/get-proto', to: 'node_modules/get-proto' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/github-from-package', to: 'node_modules/github-from-package' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/gopd', to: 'node_modules/gopd' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/graceful-fs', to: 'node_modules/graceful-fs' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/grad-school', to: 'node_modules/grad-school' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/graphql', to: 'node_modules/graphql' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/has-symbols', to: 'node_modules/has-symbols' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/has-tostringtag', to: 'node_modules/has-tostringtag' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/hasown', to: 'node_modules/hasown' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/html-parse-stringify', to: 'node_modules/html-parse-stringify' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/ieee754', to: 'node_modules/ieee754' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/inherits', to: 'node_modules/inherits' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/ini', to: 'node_modules/ini' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/ip-address', to: 'node_modules/ip-address' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/is-extglob', to: 'node_modules/is-extglob' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/is-glob', to: 'node_modules/is-glob' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/js-yaml', to: 'node_modules/js-yaml' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/jsonfile', to: 'node_modules/jsonfile' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/lazy-val', to: 'node_modules/lazy-val' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/lodash.escaperegexp', to: 'node_modules/lodash.escaperegexp' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/lodash.isequal', to: 'node_modules/lodash.isequal' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/math-intrinsics', to: 'node_modules/math-intrinsics' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/mime-db', to: 'node_modules/mime-db' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/mime-types', to: 'node_modules/mime-types' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/mimic-response', to: 'node_modules/mimic-response' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/minimist', to: 'node_modules/minimist' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/mkdirp-classic', to: 'node_modules/mkdirp-classic' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/ms', to: 'node_modules/ms' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/napi-build-utils', to: 'node_modules/napi-build-utils' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/node-abi', to: 'node_modules/node-abi' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/node-addon-api', to: 'node_modules/node-addon-api' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/object-inspect', to: 'node_modules/object-inspect' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/once', to: 'node_modules/once' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/picomatch', to: 'node_modules/picomatch' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/picomatch-browser', to: 'node_modules/picomatch-browser' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/prebuild-install', to: 'node_modules/prebuild-install' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/proxy-from-env', to: 'node_modules/proxy-from-env' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/pump', to: 'node_modules/pump' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/qs', to: 'node_modules/qs' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/rate-limiter-flexible', to: 'node_modules/rate-limiter-flexible' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/rc', to: 'node_modules/rc' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/readable-stream', to: 'node_modules/readable-stream' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/safe-buffer', to: 'node_modules/safe-buffer' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/safer-buffer', to: 'node_modules/safer-buffer' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/sax', to: 'node_modules/sax' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/semver', to: 'node_modules/semver' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/side-channel', to: 'node_modules/side-channel' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/side-channel-list', to: 'node_modules/side-channel-list' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/side-channel-map', to: 'node_modules/side-channel-map' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/side-channel-weakmap', to: 'node_modules/side-channel-weakmap' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/simple-concat', to: 'node_modules/simple-concat' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/simple-get', to: 'node_modules/simple-get' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/smart-buffer', to: 'node_modules/smart-buffer' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/socks', to: 'node_modules/socks' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/stopword', to: 'node_modules/stopword' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/string_decoder', to: 'node_modules/string_decoder' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/strip-json-comments', to: 'node_modules/strip-json-comments' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/suffix-thumb', to: 'node_modules/suffix-thumb' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/tar-fs', to: 'node_modules/tar-fs' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/tar-stream', to: 'node_modules/tar-stream' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/tiny-typed-emitter', to: 'node_modules/tiny-typed-emitter' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/tunnel-agent', to: 'node_modules/tunnel-agent' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/tweetnacl', to: 'node_modules/tweetnacl' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/universalify', to: 'node_modules/universalify' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/use-sync-external-store', to: 'node_modules/use-sync-external-store' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/util-deprecate', to: 'node_modules/util-deprecate' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/wrappy', to: 'node_modules/wrappy' },
    // [XG-CUSTOM 2026-10-02] 依赖闭包自动补全（防 whack-a-mole）
    { from: '../../node_modules/xcase', to: 'node_modules/xcase' },
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
