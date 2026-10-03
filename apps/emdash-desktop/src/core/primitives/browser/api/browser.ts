export type BrowserEvent =
  | { type: 'open-in-new-tab'; sourceBrowserId: string; url: string }
  // [XG-CUSTOM] 项我 agent 请求「从零开一个内嵌浏览器页」：主进程没有任何已绑定的内嵌浏览器时
  // （`/json/list` 为空），由 agent 侧的 9223 桥 / 跨机反向通道发出这条事件，渲染进程负责在
  // 一个 task view 里真的开出一个 Browser 标签页 —— 那个 `<webview>` attach 之后才会被
  // `bindWebContents` 绑上，agent 也才有可操作的目标。
  // 与 `open-in-new-tab` 分开，是因为后者要求 `sourceBrowserId` 指向一个**已存在**的标签页；
  // 而这条的整个意义就是「一个都不存在」。
  // `profileId`：主进程已按 bot 解析好的 profile（唯一真源 = botId）。**不带 = 与改动前一致**
  // （渲染进程用设置里的 defaultProfileId）。
  // [XG-CUSTOM 2026-10-03] `botId`：请求方 bot 名（agent 侧 `key=<botId>`）。渲染进程按它
  // **按需建/复用该 bot 的 profile**（未绑定时建 `bot-<botId>`）——丢了它，agent 开的页就落到
  // default，`/json/list` 的 `profile`/`botId` 永远是空的。
  | { type: 'open-in-embedded-browser'; url: string; profileId?: string; botId?: string }
  | { type: 'link-copied'; kind: 'image' | 'link' | 'url'; url: string };

export const BROWSER_PARTITION_PREFIX = 'persist:emdash-browser';

export const DEFAULT_BROWSER_PROFILE_ID = 'default';
export const BROWSER_ISOLATED_PROFILE_ID = 'isolated-per-task';

export type BrowserProfile = {
  id: string;
  name: string;
  // [XG-CUSTOM] bot ⟷ 浏览器身份（唯一真源 = botId）。
  // 一个 profile 至多绑定一个 bot（1:1），未绑定的 bot 落到 defaultProfileId（= 今天的 Default）。
  // 取值见 emdash 设置 → 浏览器 → 每个 profile 行的「绑定 bot」下拉。
  botId?: string;
};

export const DEFAULT_BROWSER_PROFILES: BrowserProfile[] = [
  { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default' },
];

// [XG-CUSTOM] 自动建 profile 的 id 前缀 / botId 规范化（`bot-sxsj`、`bot-chief-engineer`）
export const BROWSER_BOT_PROFILE_PREFIX = 'bot-';

export function normalizeBrowserBotId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

export type BrowserProfileSelection = string;

export const BROWSER_PROFILE_PARTITION = `${BROWSER_PARTITION_PREFIX}-profile`;

export type BrowserNavigationProtocol = 'about:' | 'file:' | 'http:' | 'https:';

export type BrowserUrlNormalizeResult =
  | { ok: true; url: string; protocol: BrowserNavigationProtocol }
  | { ok: false; reason: BrowserUrlRejectionReason };

export type BrowserUrlRejectionReason =
  | 'empty'
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'unsupported-file-url';

export type BrowserUrlNormalizeOptions = {
  allowFileUrls?: boolean;
  allowSearchQueries?: boolean;
};

export type BrowserSessionIdentity = {
  browserId: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
};

export type BrowserLoadError = {
  code?: number;
  description: string;
  url?: string;
};

export type BrowserSessionSnapshot = BrowserSessionIdentity & {
  profileId: BrowserProfileSelection;
  partition: string;
  currentUrl: string;
  title: string;
  faviconUrl?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  loadError?: BrowserLoadError;
  createdAt: number;
  updatedAt: number;
};

export type BrowserSessionRestoreInput = Omit<BrowserSessionSnapshot, 'zoomFactor'> & {
  zoomFactor?: number;
};

export type BrowserDataClearKind = 'storage' | 'cookies' | 'cache';

export function isBrowserDataClearKind(kind: string): kind is BrowserDataClearKind {
  return kind === 'storage' || kind === 'cookies' || kind === 'cache';
}

// Granular categories for clearing browsing data across the in-app browser
// profiles from settings. `all` wipes everything; the rest map to Electron
// `session.clearData({ dataTypes })` groups.
export type BrowsingDataKind = 'all' | 'cookies' | 'siteData' | 'cache';

export function isBrowsingDataKind(value: string): value is BrowsingDataKind {
  return value === 'all' || value === 'cookies' || value === 'siteData' || value === 'cache';
}

export type BrowserDiagnosticsLevel = 'info' | 'warning' | 'error';

export type BrowserDiagnosticsEntry = {
  id: string;
  browserId: string;
  level: BrowserDiagnosticsLevel;
  source: 'console' | 'navigation' | 'network';
  message: string;
  url?: string;
  line?: number;
  column?: number;
  timestamp: number;
};

export const BROWSER_DEFAULT_URL = 'about:blank';
export const BROWSER_DEFAULT_SEARCH_URL = 'https://www.google.com/search';

const BROWSER_RESERVED_SCHEMES = new Set(['about', 'data', 'file', 'http', 'https', 'javascript']);

export const BROWSER_ZOOM_FACTORS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
] as const;

export const BROWSER_DEFAULT_ZOOM_FACTOR = 1;

const ZOOM_EPSILON = 0.001;

export function normalizeBrowserZoomFactor(factor: number | undefined): number {
  if (factor === undefined || !Number.isFinite(factor)) return BROWSER_DEFAULT_ZOOM_FACTOR;
  const min = BROWSER_ZOOM_FACTORS[0];
  const max = BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1];
  return Math.min(max, Math.max(min, factor));
}

export function nextBrowserZoomFactor(factor: number): number {
  const current = normalizeBrowserZoomFactor(factor);
  for (const step of BROWSER_ZOOM_FACTORS) {
    if (step > current + ZOOM_EPSILON) return step;
  }
  return BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1];
}

export function previousBrowserZoomFactor(factor: number): number {
  const current = normalizeBrowserZoomFactor(factor);
  for (let i = BROWSER_ZOOM_FACTORS.length - 1; i >= 0; i--) {
    if (BROWSER_ZOOM_FACTORS[i] < current - ZOOM_EPSILON) return BROWSER_ZOOM_FACTORS[i];
  }
  return BROWSER_ZOOM_FACTORS[0];
}

export function canZoomIn(factor: number): boolean {
  return (
    normalizeBrowserZoomFactor(factor) <
    BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1] - ZOOM_EPSILON
  );
}

export function canZoomOut(factor: number): boolean {
  return normalizeBrowserZoomFactor(factor) > BROWSER_ZOOM_FACTORS[0] + ZOOM_EPSILON;
}

export function isDefaultBrowserZoomFactor(factor: number): boolean {
  return Math.abs(normalizeBrowserZoomFactor(factor) - BROWSER_DEFAULT_ZOOM_FACTOR) < ZOOM_EPSILON;
}

export function formatBrowserZoomPercent(factor: number): string {
  return `${Math.round(normalizeBrowserZoomFactor(factor) * 100)}%`;
}

export function normalizeBrowserUrl(
  rawInput: string,
  options: BrowserUrlNormalizeOptions = {}
): BrowserUrlNormalizeResult {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (trimmed === 'about:blank') {
    return { ok: true, url: BROWSER_DEFAULT_URL, protocol: 'about:' };
  }

  if (options.allowSearchQueries !== false && isSearchQuery(trimmed)) {
    return { ok: true, url: browserSearchUrl(trimmed), protocol: 'https:' };
  }

  const candidate = withDefaultScheme(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return { ok: true, url: parsed.toString(), protocol: parsed.protocol };
  }

  if (parsed.protocol === 'file:') {
    if (!options.allowFileUrls) {
      return { ok: false, reason: 'unsupported-file-url' };
    }
    return { ok: true, url: parsed.toString(), protocol: 'file:' };
  }

  return { ok: false, reason: 'unsupported-protocol' };
}

export function makeBrowserSessionIdentity(input: {
  projectId: string;
  workspaceId: string;
  taskId: string;
  browserId?: string;
}): BrowserSessionIdentity {
  return {
    browserId: input.browserId ?? crypto.randomUUID(),
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
  };
}

export function browserProfilePartition(profileId: string): string {
  if (profileId === DEFAULT_BROWSER_PROFILE_ID) return BROWSER_PROFILE_PARTITION;
  return `${BROWSER_PARTITION_PREFIX}-profile-${profileId}`;
}

export function makeIsolatedBrowserPartition(identity: BrowserSessionIdentity): string {
  return [
    BROWSER_PARTITION_PREFIX,
    'isolated',
    partitionComponent(identity.projectId),
    partitionComponent(identity.workspaceId),
    partitionComponent(identity.taskId),
  ].join('-');
}

export function browserPartitionForProfile(
  identity: BrowserSessionIdentity,
  profileId: BrowserProfileSelection
): string {
  if (profileId === BROWSER_ISOLATED_PROFILE_ID) return makeIsolatedBrowserPartition(identity);
  return browserProfilePartition(profileId);
}

export function isNamedBrowserProfileId(value: string): boolean {
  return value !== BROWSER_ISOLATED_PROFILE_ID && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

export function normalizeBrowserProfileSelection(
  profileId: string | undefined,
  profiles?: readonly BrowserProfile[]
): BrowserProfileSelection {
  if (profileId === BROWSER_ISOLATED_PROFILE_ID) {
    return profileId;
  }
  if (profileId && isNamedBrowserProfileId(profileId)) {
    if (!profiles || profiles.some((profile) => profile.id === profileId)) return profileId;
  }
  return (
    profiles?.find((profile) => isNamedBrowserProfileId(profile.id))?.id ??
    DEFAULT_BROWSER_PROFILE_ID
  );
}

export function browserProfileLabel(
  profileId: string,
  profiles: readonly BrowserProfile[]
): string {
  if (profileId === BROWSER_ISOLATED_PROFILE_ID) return 'Isolated per task';
  return profiles.find((profile) => profile.id === profileId)?.name ?? profileId;
}

// ── [XG-CUSTOM] bot ⟷ profile ────────────────────────────────────────────────
// 「谁是唯一真源」：**botId**。profile 只是 botId 派生出来的浏览器身份载体
// （设置页手动建 profile 时可选绑定一个 bot；未绑定 = 只有人手动选才会用到它）。

/** 这个 profile 属于哪个 bot（未绑定 → undefined）。 */
export function browserProfileBotId(
  profileId: string,
  profiles: readonly BrowserProfile[]
): string | undefined {
  const botId = profiles.find((profile) => profile.id === profileId)?.botId;
  return typeof botId === 'string' && botId.trim() !== '' ? botId.trim() : undefined;
}

/**
 * 该 bot 应该用哪个 profile：绑定了它自己的那个 → 否则 `defaultProfileId`（兼容：
 * 未绑定 bot 的一切行为与今天一致）；`defaultProfileId` 非法时退第一个具名 profile。
 */
export function resolveBotBrowserProfileId(
  botId: string | undefined,
  profiles: readonly BrowserProfile[],
  defaultProfileId?: string
): string {
  const wanted = typeof botId === 'string' ? botId.trim() : '';
  if (wanted !== '') {
    const bound = profiles.find((profile) => browserProfileBotId(profile.id, profiles) === wanted);
    if (bound) return bound.id;
  }
  return normalizeBrowserProfileSelection(defaultProfileId, profiles);
}

/** `Add profile` / 自动建 profile 用：`bot-<botId>`，重名就加 `-2`、`-3`… */
export function makeBotBrowserProfileId(
  botId: string,
  profiles: readonly BrowserProfile[]
): string {
  const existingIds = new Set(profiles.map((profile) => profile.id));
  const slug = normalizeBrowserBotId(botId) || 'bot';
  const base = `${BROWSER_BOT_PROFILE_PREFIX}${slug}`.slice(0, 64).replace(/-+$/g, '');
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate) || !isNamedBrowserProfileId(candidate)) {
    const suffixText = String(suffix);
    candidate = `${base.slice(0, Math.max(1, 63 - suffixText.length))}-${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * [XG-CUSTOM] 从 partition 反推 profileId（`/json/list` 要给 agent 报 profile/botId，
 * 而主进程能拿到的只有 partition —— 见 browser-profile-session.ts 的 browserProfilePartition）。
 * 认不出来（per-task 隔离分区 / 非浏览器分区）→ undefined。
 */
export function browserProfileIdFromPartition(partition: string): string | undefined {
  if (partition === BROWSER_PROFILE_PARTITION) return DEFAULT_BROWSER_PROFILE_ID;
  const prefix = `${BROWSER_PROFILE_PARTITION}-`;
  if (!partition.startsWith(prefix)) return undefined;
  const id = partition.slice(prefix.length);
  return isNamedBrowserProfileId(id) ? id : undefined;
}

export function createBrowserSessionSnapshot(input: {
  identity: BrowserSessionIdentity;
  profileId?: BrowserProfileSelection;
  currentUrl?: string;
  now?: number;
}): BrowserSessionSnapshot {
  const now = input.now ?? Date.now();
  const profileId = normalizeBrowserProfileSelection(input.profileId);
  const normalized = normalizeBrowserUrl(input.currentUrl ?? BROWSER_DEFAULT_URL, {
    allowSearchQueries: false,
  });
  return {
    ...input.identity,
    profileId,
    partition: browserPartitionForProfile(input.identity, profileId),
    currentUrl: normalized.ok ? normalized.url : BROWSER_DEFAULT_URL,
    title: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: BROWSER_DEFAULT_ZOOM_FACTOR,
    createdAt: now,
    updatedAt: now,
  };
}

function partitionComponent(value: string): string {
  const safe = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'unknown';
}

function browserSearchUrl(query: string): string {
  const url = new URL(BROWSER_DEFAULT_SEARCH_URL);
  url.searchParams.set('q', query);
  return url.toString();
}

function isSearchQuery(input: string): boolean {
  if (isLocalhostLike(input)) return false;

  const scheme = explicitSchemePrefix(input);
  if (scheme) {
    return /\s/.test(input) && !BROWSER_RESERVED_SCHEMES.has(scheme.toLowerCase());
  }

  return !looksLikeNavigableHost(input);
}

function looksLikeNavigableHost(input: string): boolean {
  const hostLike = input.split(/[/?#]/, 1)[0].toLowerCase();
  if (hostLike.length === 0 || /\s/.test(hostLike)) return false;
  if (hostLike.startsWith('[') && hostLike.includes(']')) return true;
  return hostLike.includes('.');
}

function withDefaultScheme(input: string): string {
  if (isLocalhostLike(input)) {
    return `http://${input}`;
  }
  if (explicitSchemePrefix(input)) {
    return input;
  }
  return `https://${input}`;
}

function explicitSchemePrefix(input: string): string | null {
  const colonIndex = input.indexOf(':');
  if (colonIndex <= 0) return null;
  const prefix = input.slice(0, colonIndex);
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*$/.test(prefix)) return null;
  if (prefix.includes('.')) return null;
  return prefix;
}

function isLocalhostLike(input: string): boolean {
  const hostLike = input.split(/[/?#]/, 1)[0].toLowerCase();
  return (
    hostLike === 'localhost' ||
    hostLike.startsWith('localhost:') ||
    hostLike === '127.0.0.1' ||
    hostLike.startsWith('127.0.0.1:') ||
    hostLike === '[::1]' ||
    hostLike.startsWith('[::1]:') ||
    hostLike.endsWith('.localhost') ||
    hostLike.includes('.localhost:')
  );
}
