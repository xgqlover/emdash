import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] 中文界面文案（zh i18n，详见 CUSTOMIZATIONS.md）
import { SettingsCard, SettingsSection } from '@emdash/ui/react/patterns';
import {
  Button,
  DropdownMenu,
  Input,
  Select,
  SeparatedList,
  Switch,
  toast,
} from '@emdash/ui/react/primitives';
import { Check, ChevronDown, Ellipsis, Eraser, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { browserControlsRegistry } from '@core/features/browser/api/browser/browser-controls-registry';
import { browserSessionStore } from '@core/features/browser/api/browser/browser-session-store';
import { getBrowserClient } from '@core/features/browser/api/browser/client';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { useOpenModal } from '@core/manifests/browser/modal-api';
// [XG-CUSTOM] bot ⟷ 浏览器 profile：bot 列表复用已有「专家名册」主机桥（xiangwo-agent/expert_roster.py）
import { expertRoster } from '@core/primitives/desktop-host/browser/host-client';
import {
  BROWSER_ISOLATED_PROFILE_ID,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_PROFILES,
  browserProfileBotId,
  browserProfileLabel,
  isNamedBrowserProfileId,
  normalizeBrowserProfileSelection,
  type BrowserProfile,
  type BrowsingDataKind,
} from '@core/primitives/browser/api';
import { cn } from '@core/primitives/styling/browser/cn';
import { SettingRow } from './SettingRow';

export function BrowserSettingsCard() {
  const {
    value: browserSettings,
    update,
    updateAsync,
    isLoading,
    isSaving,
  } = useAppSettingsKey('browser');
  const openConfirm = useOpenModal('confirmActionModal');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isBrowsingDataExpanded, setIsBrowsingDataExpanded] = useState(false);
  const [isClearingBrowsingData, setIsClearingBrowsingData] = useState(false);
  // [XG-CUSTOM] 可绑定的 bot 列表（来自专家名册；读不到就只显示"未绑定"一项，不影响其它功能）
  const [botOptions, setBotOptions] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const addInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const profiles = browserSettings?.profiles ?? DEFAULT_BROWSER_PROFILES;
  const selectedDefault = normalizeBrowserProfileSelection(
    browserSettings?.defaultProfileId,
    profiles
  );
  const disabled = isLoading || isSaving;

  // [XG-CUSTOM] bot 名册：优先主 bot（main）+ 通用角色（role）+ 子代理（sub）—— 这三种都可能
  // 是 `_exec_browser(key=...)` 的 key。读不到（agent 没起 / 桥不通）只 warn，不阻塞设置页。
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const roster = (await expertRoster()) as {
          groups?: ReadonlyArray<{
            kind?: string;
            items?: ReadonlyArray<{ id?: string; name?: string }>;
          }>;
        };
        const wanted = new Set(['main', 'role', 'sub']);
        const options: Array<{ id: string; name: string }> = [];
        for (const group of roster.groups ?? []) {
          if (!wanted.has(group.kind ?? '')) continue;
          for (const item of group.items ?? []) {
            const id = typeof item.id === 'string' ? item.id : '';
            if (id === '' || id === '(未归类)') continue;
            options.push({ id, name: typeof item.name === 'string' && item.name ? item.name : id });
          }
        }
        if (!disposed) setBotOptions(options);
      } catch (error) {
        console.warn('[XG-CUSTOM] 读取 bot 名册失败（绑定下拉为空，其它功能不受影响）', error);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  /**
   * [XG-CUSTOM] 把某个 profile 绑定到（或解绑）一个 bot。
   * 1:1 硬约束：同一个 bot 只能绑一个 profile —— 先把它从别的 profile 上摘掉，再挂到目标上。
   * 绑成 Default 也允许（那样"默认身份"就固定给这个 bot 了）。
   */
  const bindProfileBot = (profileId: string, botId: string) => {
    update({
      profiles: profiles.map((profile) => {
        if (profile.id === profileId) return withBotId(profile, botId);
        // 1:1：同一个 bot 不许同时挂在两个 profile 上（否则开页时不知道用谁的登录态）
        if (botId !== '' && profile.botId === botId) return withBotId(profile, '');
        return profile;
      }),
    });
  };

  const addProfile = (name: string) => {
    setIsAdding(false);
    const nextName = name.trim();
    if (!nextName) return;
    const profile: BrowserProfile = { id: makeProfileId(nextName, profiles), name: nextName };
    update({ profiles: [...profiles, profile] });
  };

  const renameProfile = (profileId: string, name: string) => {
    setEditingProfileId(null);
    const nextName = name.trim();
    if (!nextName) return;
    update({
      profiles: profiles.map((profile) =>
        profile.id === profileId ? { ...profile, name: nextName } : profile
      ),
    });
  };

  const clearProfileStorage = (profile: BrowserProfile) => {
    void openConfirm({
      title: `Clear ${profile.name} browser storage?`,
      description:
        'This clears cookies, local storage, IndexedDB, and cache for this profile. Browser tabs using it will be signed out.',
      confirmLabel: 'Clear Storage',
      variant: 'destructive',
    }).then((outcome) => {
      if (outcome.success) void clearProfileStorageAndReload(profile.id);
    });
  };

  const runClearBrowsingData = async (kind: BrowsingDataKind, label: string) => {
    setIsClearingBrowsingData(true);
    try {
      const result = await (await getBrowserClient()).clearBrowsingData({ kind });
      if (!result.success) {
        toast.error('Could not clear browsing data', {
          description: 'Try again, or reload the browser view manually.',
        });
        return;
      }
      reloadAllBrowserSessions();
      toast(`${label} cleared`);
    } catch (error) {
      toast.error('Could not clear browsing data', { description: errorMessage(error) });
    } finally {
      setIsClearingBrowsingData(false);
    }
  };

  const clearBrowsingData = (kind: BrowsingDataKind, label: string) => {
    void openConfirm({
      ...BROWSING_DATA_CONFIRMATIONS[kind],
      variant: 'destructive',
    }).then((outcome) => {
      if (outcome.success) void runClearBrowsingData(kind, label);
    });
  };

  const deleteProfile = (profile: BrowserProfile) => {
    if (profiles.length <= 1) return;
    void openConfirm({
      title: `Delete ${profile.name} browser profile?`,
      description:
        'This removes the profile and clears its cookies, local storage, IndexedDB, and cache.',
      confirmLabel: 'Delete Profile',
      variant: 'destructive',
    }).then((outcome) => {
      if (!outcome.success) return;
      const nextProfiles = profiles.filter((candidate) => candidate.id !== profile.id);
      const replacementProfileId =
        selectedDefault === profile.id
          ? (nextProfiles[0]?.id ?? DEFAULT_BROWSER_PROFILE_ID)
          : selectedDefault;
      void deleteProfileAfterStorageClear({
        deletedProfileId: profile.id,
        replacementProfileId,
        nextProfiles,
        updateAsync,
      });
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <SettingsCard>
        <SeparatedList gap="1rem" direction="column">
          <SettingRow
            title={t('default_browser_profile')}
            description={t('default_browser_profile_desc')}
            control={
              <Select.Root
                value={selectedDefault}
                onValueChange={(next) => {
                  if (next) update({ defaultProfileId: next });
                }}
                disabled={disabled}
              >
                <Select.Trigger className="w-[190px] shrink-0 gap-2">
                  <Select.Value>{browserProfileLabel(selectedDefault, profiles)}</Select.Value>
                </Select.Trigger>
                <Select.Content align="end">
                  {profiles.map((profile) => (
                    <Select.Item key={profile.id} value={profile.id}>
                      {profile.name}
                    </Select.Item>
                  ))}
                  <Select.Item value={BROWSER_ISOLATED_PROFILE_ID}>{t('isolated_per_task')}</Select.Item>
                </Select.Content>
              </Select.Root>
            }
          />

          <SettingRow
            title={t('disable_cors_localhost')}
            description={t('disable_cors_desc')}
            control={
              <Switch
                checked={browserSettings?.relaxCorsForLocalhost ?? false}
                disabled={disabled}
                onCheckedChange={(next) => update({ relaxCorsForLocalhost: next })}
              />
            }
          />
        </SeparatedList>
      </SettingsCard>

      <SettingsSection title={t('browser_profiles')} bare>
        <SettingsCard>
          <div className="text-xs text-foreground-passive">
            {t('browser_profiles_desc')}
          </div>
          {/* [XG-CUSTOM] bot ⟷ profile 说明（唯一真源 = botId；未绑定的 bot 走 Default） */}
          <div className="mt-1 text-xs text-foreground-passive">
            Bind a profile to a bot so that bot browses with its own cookies and logins. Unbound
            bots use the default profile.
          </div>

          <div className="mt-2 flex flex-col divide-y divide-border/40">
            {profiles.map((profile) => (
              <div key={profile.id} className="flex h-9 items-center gap-2">
                {editingProfileId === profile.id ? (
                  <>
                    <Input
                      ref={renameInputRef}
                      autoFocus
                      defaultValue={profile.name}
                      disabled={disabled}
                      aria-label={`Rename ${profile.name} browser profile`}
                      className="h-7 min-w-0 flex-1"
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter')
                          renameProfile(profile.id, event.currentTarget.value);
                        if (event.key === 'Escape') setEditingProfileId(null);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      icon
                      className="size-7 shrink-0 text-foreground-muted"
                      disabled={disabled}
                      aria-label={`Save ${profile.name} browser profile name`}
                      onClick={() => renameProfile(profile.id, renameInputRef.current?.value ?? '')}
                    >
                      <Check className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      icon
                      className="size-7 shrink-0 text-foreground-muted"
                      disabled={disabled}
                      aria-label={`Cancel renaming ${profile.name} browser profile`}
                      onClick={() => setEditingProfileId(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {profile.name}
                    </span>
                    {/* [XG-CUSTOM] bot ⟷ profile：这一行 profile 属于哪个 bot（未绑定 = Default 才会
                        被没绑定身份的 agent 用到）。选项来自专家名册（main/role/sub 三类身份）。 */}
                    <Select.Root
                      value={browserProfileBotId(profile.id, profiles) ?? UNBOUND_BOT_VALUE}
                      onValueChange={(next) =>
                        bindProfileBot(
                          profile.id,
                          next === UNBOUND_BOT_VALUE || next === null ? '' : next
                        )
                      }
                      disabled={disabled}
                    >
                      <Select.Trigger
                        className="w-[150px] shrink-0 gap-1"
                        aria-label={`${profile.name} bound bot`}
                      >
                        <Select.Value>
                          {botLabelFor(profile, botOptions)}
                        </Select.Value>
                      </Select.Trigger>
                      <Select.Content align="end">
                        <Select.Item value={UNBOUND_BOT_VALUE}>未绑定 bot</Select.Item>
                        {botOptions.map((bot) => (
                          <Select.Item key={bot.id} value={bot.id}>
                            {bot.name}
                          </Select.Item>
                        ))}
                        {/* 绑定了一个名册里暂时读不到的 bot（agent 没起 / 名字改了）也要显示出来，
                            否则下拉会显示成"未绑定"，用户一改就把绑定悄悄抹掉 */}
                        {(() => {
                          const bound = browserProfileBotId(profile.id, profiles);
                          return bound !== undefined && !botOptions.some((b) => b.id === bound) ? (
                            <Select.Item value={bound}>{bound}</Select.Item>
                          ) : null;
                        })()}
                      </Select.Content>
                    </Select.Root>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            icon
                            className="size-7 shrink-0 text-foreground-muted"
                            disabled={disabled}
                            aria-label={`${profile.name} browser profile actions`}
                          />
                        }
                      >
                        <Ellipsis className="size-4" />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content
                        align="end"
                        className="min-w-40"
                        finalFocus={renameInputRef}
                      >
                        <DropdownMenu.Item onClick={() => setEditingProfileId(profile.id)}>
                          <Pencil className="size-4" />
                          {t('rename')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onClick={() => clearProfileStorage(profile)}>
                          <Eraser className="size-4" />
                          {t('clear_storage')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                          variant="destructive"
                          disabled={profiles.length <= 1}
                          onClick={() => deleteProfile(profile)}
                        >
                          <Trash2 className="size-4" />
                          {t('delete')}
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="mt-2 flex h-7 items-center">
            {isAdding ? (
              <div className="flex w-full items-center gap-2">
                <Input
                  ref={addInputRef}
                  autoFocus
                  disabled={disabled}
                  placeholder="Profile name"
                  aria-label="New browser profile name"
                  className="h-7 min-w-0 flex-1"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addProfile(event.currentTarget.value);
                    if (event.key === 'Escape') setIsAdding(false);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  icon
                  className="size-7 shrink-0 text-foreground-muted"
                  disabled={disabled}
                  aria-label="Save new browser profile"
                  onClick={() => addProfile(addInputRef.current?.value ?? '')}
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon
                  className="size-7 shrink-0 text-foreground-muted"
                  disabled={disabled}
                  aria-label="Cancel adding profile"
                  onClick={() => setIsAdding(false)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-foreground-muted"
                disabled={disabled}
                onClick={() => setIsAdding(true)}
              >
                <Plus className="size-4" />
                Add profile
              </Button>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Browsing data" bare>
        <SettingsCard>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
              <div className="text-xs text-foreground-passive">
                Clear cookies, cached files, and site data from the in-app browser.
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-foreground-muted"
                disabled={disabled || isClearingBrowsingData}
                onClick={() => clearBrowsingData('all', 'All browsing data')}
              >
                Clear all browsing data
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon
                className="shrink-0 text-foreground-muted"
                aria-expanded={isBrowsingDataExpanded}
                aria-label={
                  isBrowsingDataExpanded
                    ? 'Hide individual browsing data options'
                    : 'Show individual browsing data options'
                }
                onClick={() => setIsBrowsingDataExpanded((expanded) => !expanded)}
              >
                <ChevronDown
                  className={cn(
                    'size-4 transition-transform',
                    isBrowsingDataExpanded && 'rotate-180'
                  )}
                />
              </Button>
            </div>
          </div>

          {isBrowsingDataExpanded && (
            <div className="mt-2 flex flex-col divide-y divide-border/40">
              {BROWSING_DATA_CATEGORIES.map((category) => (
                <div key={category.kind} className="flex h-9 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {category.label}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-foreground-muted"
                    disabled={disabled || isClearingBrowsingData}
                    onClick={() => clearBrowsingData(category.kind, category.label)}
                  >
                    {category.actionLabel}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

// [XG-CUSTOM] bot ⟷ profile：「未绑定」在下拉里的哨兵值（空串不是合法的 Select value）
const UNBOUND_BOT_VALUE = '__unbound__';

/** [XG-CUSTOM] 设置某个 profile 的 botId；空串 = 解绑（写回不带 botId 的干净对象）。 */
function withBotId(profile: BrowserProfile, botId: string): BrowserProfile {
  if (botId === '') return { id: profile.id, name: profile.name };
  return { id: profile.id, name: profile.name, botId };
}

/** [XG-CUSTOM] 行内显示：绑定的 bot 名（名册里找不到就显示 id 本身）。 */
function botLabelFor(
  profile: BrowserProfile,
  botOptions: ReadonlyArray<{ id: string; name: string }>
): string {
  const botId = profile.botId?.trim();
  if (botId === undefined || botId === '') return '未绑定 bot';
  return botOptions.find((bot) => bot.id === botId)?.name ?? botId;
}

const BROWSING_DATA_CATEGORIES: ReadonlyArray<{
  kind: Exclude<BrowsingDataKind, 'all'>;
  label: string;
  actionLabel: string;
}> = [
  { kind: 'cookies', label: 'Cookies', actionLabel: 'Delete cookies' },
  { kind: 'siteData', label: 'Site data', actionLabel: 'Delete site data' },
  {
    kind: 'cache',
    label: 'Cached images and files',
    actionLabel: 'Delete cached images and files',
  },
];

const BROWSING_DATA_CONFIRMATIONS: Record<
  BrowsingDataKind,
  { title: string; description: string; confirmLabel: string }
> = {
  all: {
    title: 'Clear all browsing data?',
    description:
      'This deletes cookies, cached files, and site data for every in-app browser profile. Open browser tabs will be signed out.',
    confirmLabel: 'Clear all data',
  },
  cookies: {
    title: 'Delete cookies?',
    description:
      'This deletes cookies for every in-app browser profile. Open browser tabs will be signed out.',
    confirmLabel: 'Delete cookies',
  },
  siteData: {
    title: 'Delete site data?',
    description:
      'This deletes local storage, IndexedDB, service workers, and other site data for every in-app browser profile. Open browser tabs may be signed out.',
    confirmLabel: 'Delete site data',
  },
  cache: {
    title: 'Delete cached images and files?',
    description:
      'This deletes cached images and files for every in-app browser profile. Pages may load more slowly the next time you open them.',
    confirmLabel: 'Delete cached files',
  },
};

function reloadAllBrowserSessions(): void {
  for (const session of browserSessionStore.activeSessions) {
    browserControlsRegistry.get(session.browserId)?.adapter?.reload();
  }
}

async function clearProfileStorageAndReload(profileId: string): Promise<void> {
  try {
    const result = await (await getBrowserClient()).clearProfileStorage({ profileId });
    if (!result.success) {
      toast.error('Could not clear browser storage', {
        description: 'The browser profile no longer exists or could not be cleared.',
      });
      return;
    }
    reloadBrowserSessionsForProfile(profileId);
  } catch (error) {
    toast.error('Could not clear browser storage', { description: errorMessage(error) });
  }
}

async function deleteProfileAfterStorageClear({
  deletedProfileId,
  replacementProfileId,
  nextProfiles,
  updateAsync,
}: {
  deletedProfileId: string;
  replacementProfileId: string;
  nextProfiles: BrowserProfile[];
  updateAsync: (partial: { profiles: BrowserProfile[]; defaultProfileId: string }) => Promise<void>;
}): Promise<void> {
  let storageCleared = false;
  try {
    const clearResult = await (
      await getBrowserClient()
    ).clearProfileStorage({
      profileId: deletedProfileId,
    });
    if (!clearResult.success) {
      toast.error('Could not delete browser profile', {
        description: 'The profile storage could not be cleared, so the profile was kept.',
      });
      return;
    }

    storageCleared = true;
    await updateAsync({
      profiles: nextProfiles,
      defaultProfileId: replacementProfileId,
    });
    browserSessionStore.migrateProfileSessions(
      deletedProfileId,
      replacementProfileId,
      nextProfiles
    );
  } catch (error) {
    if (storageCleared) reloadBrowserSessionsForProfile(deletedProfileId);
    toast.error('Could not delete browser profile', {
      description: storageCleared
        ? `Storage was cleared, but the profile is still listed. ${errorMessage(error)}`
        : errorMessage(error),
    });
  }
}

function reloadBrowserSessionsForProfile(profileId: string): void {
  for (const session of browserSessionStore.activeSessions) {
    if (session.profileId !== profileId) continue;
    browserControlsRegistry.get(session.browserId)?.adapter?.reload();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeProfileId(name: string, profiles: readonly BrowserProfile[]): string {
  const existingIds = new Set(profiles.map((profile) => profile.id));
  const base = slugifyProfileName(name) || 'profile';
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate) || !isNamedBrowserProfileId(candidate)) {
    const suffixText = String(suffix);
    const prefixLength = Math.max(1, 63 - suffixText.length);
    candidate = `${base.slice(0, prefixLength)}-${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

function slugifyProfileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}
