import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import { settingsPageContributions } from '@core/manifests/browser/settings-page-contributions';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export type SettingsSearchEntry = {
  /** Stable kebab-case id; for SettingRow-backed settings it equals slugifySettingLabel(label). */
  id: string;
  /** The visible label of the setting in the UI. */
  label: string;
  tab: Exclude<SettingsPageTab, 'docs'>;
  description?: string;
  /** Extra terms (synonyms, provider names) that should also match this entry. */
  keywords?: string[];
};

/** Derives a stable search-entry id from a visible label. */
export function slugifySettingLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const trayIconLabel =
  detectPlatformContext().os === 'mac'
    ? 'Show Emdash in the menu bar'
    : 'Show Emdash in the system tray';

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  // General
  {
    id: 'version',
    label: 'Version',
    tab: 'general',
    description: t('app_version_and_updates'),
    keywords: ['update', 'upgrade', 'restart', 'release'],
  },
  {
    id: 'privacy-telemetry',
    label: t('privacy_telemetry'),
    tab: 'general',
    description: t('help_improve_emdash_by_sending_anonymous'),
    keywords: ['analytics', 'posthog', 'usage data', 'tracking'],
  },
  {
    id: 'auto-generate-task-names',
    label: t('auto_generate_task_names_2'),
    tab: 'general',
    description: t('automatically_suggests_a_task_name_when_'),
  },
  {
    id: 'auto-trust-worktree-directories',
    label: t('auto_trust_worktree_directories'),
    tab: 'general',
    description: t('skip_the_folder_trust_prompt_in_supporte'),
    keywords: ['trust', 'claude code', 'copilot'],
  },
  {
    id: 'create-branch-and-worktree-by-default',
    label: t('create_branch_and_worktree_by_default'),
    tab: 'general',
    description: t('start_new_from_branch_tasks_in_a_dedicat'),
    keywords: ['git'],
  },
  {
    id: 'preserve-task-name-capitalization',
    label: t('preserve_task_name_capitalization'),
    tab: 'general',
    description: t('keep_uppercase_letters_in_generated_and_'),
    keywords: ['lowercase', 'uppercase'],
  },
  {
    id: 'include-issue-context-by-default',
    label: t('include_issue_context_by_default'),
    tab: 'general',
    description: t('add_the_selected_issue_to_the_initial_ag'),
  },
  {
    id: 'enable-tmux',
    label: t('enable_tmux'),
    tab: 'general',
    description: t('run_agent_sessions_and_terminals_in_tmux'),
    keywords: ['multiplexer'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    tab: 'general',
    description: t('get_notified_when_agents_need_your_atten'),
    keywords: ['alerts'],
  },
  {
    id: 'sound',
    label: 'Sound',
    tab: 'general',
    description: t('play_audio_cues_for_agent_events'),
    keywords: ['audio', 'notifications'],
  },
  {
    id: 'custom-sound',
    label: t('custom_sound_2'),
    tab: 'general',
    description: t('use_an_audio_file_instead_of_the_built_i'),
    keywords: ['audio', 'notifications'],
  },
  {
    id: 'sound-timing',
    label: t('sound_timing_2'),
    tab: 'general',
    description: t('when_to_play_sounds'),
    keywords: ['audio', 'notifications', 'unfocused'],
  },
  {
    id: 'os-notifications',
    label: t('os_notifications'),
    tab: 'general',
    description: t('show_system_banners_when_agents_need_att'),
    keywords: ['banner', 'system'],
  },
  {
    id: 'emdash-account',
    label: t('emdash_account'),
    tab: 'general',
    description: t('create_an_emdash_account_to_automaticall'),
    keywords: ['sign in', 'sign out', 'login', 'logout', 'oauth'],
  },

  // Agents
  {
    id: 'agents',
    label: 'Agents',
    tab: 'clis-models',
    description: t('manage_installed_cli_agents_and_their_co'),
    keywords: ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'cli'],
  },
  {
    id: 'mcp',
    label: 'MCP',
    tab: 'mcp',
    description: t('manage_local_mcp_servers_available_to_ag'),
    keywords: ['model context protocol', 'servers', 'tools'],
  },
  {
    id: 'skills',
    label: 'Skills',
    tab: 'skills',
    description: t('manage_reusable_local_agent_skills'),
    keywords: ['skill modules', 'agents'],
  },

  // Integrations
  {
    id: 'integrations',
    label: 'Integrations',
    tab: 'integrations',
    description: t('connect_issue_trackers_and_source_contro'),
    keywords: ['github', 'gitlab', 'linear', 'jira', 'youtrack', 'issues', 'connect'],
  },

  // Connections
  {
    id: 'ssh-connections',
    label: 'Machines',
    tab: 'connections',
    description: t('reusable_remote_hosts_for_ssh_projects'),
    keywords: ['remote', 'host'],
  },

  // Repository
  {
    id: 'branch-prefix',
    label: t('branch_prefix'),
    tab: 'repository',
    description: t('leave_empty_to_create_branches_without_a'),
    keywords: ['git'],
  },
  {
    id: 'random-branch-suffix',
    label: t('random_branch_suffix'),
    tab: 'repository',
    description: t('add_a_random_suffix_to_branch_names'),
    keywords: ['git'],
  },
  {
    id: 'auto-push-on-create',
    label: t('auto_push_on_create'),
    tab: 'repository',
    description: t('push_the_new_branch_to_the_selected_proj'),
    keywords: ['git', 'remote', 'upstream'],
  },
  // Local workspaces
  {
    id: 'task-worktree-storage',
    label: 'Workspaces',
    tab: 'workspaces-local',
    description: t('review_task_worktree_usage_and_remove_st'),
    keywords: ['disk', 'cleanup', 'storage', 'worktrees'],
  },

  // Conversations
  {
    id: 'conversations',
    label: 'Conversations',
    tab: 'conversations',
    description: t('every_conversation_record_on_this_machin'),
    keywords: ['chats', 'sessions', 'orphaned', 'history', 'agents'],
  },

  // Prompts
  {
    id: 'prompts',
    label: 'Prompts',
    tab: 'prompts',
    description: t('manage_reusable_prompts_for_tasks_and_co'),
    keywords: ['prompt library', 'snippets'],
  },

  {
    id: 'usage',
    label: 'Usage',
    tab: 'usage',
    description: t('subscription_limits_for_codex_and_claude'),
    keywords: ['limits', 'quota', 'subscription', 'account', 'codex', 'claude', 'reset'],
  },

  // System
  {
    id: 'system',
    label: 'System',
    tab: 'system',
    description: t('review_local_resource_utilization_and_sy'),
    keywords: ['cpu', 'memory', 'disk', 'dependencies', 'git', 'tmux'],
  },

  // Interface
  {
    id: slugifySettingLabel(trayIconLabel),
    label: trayIconLabel,
    tab: 'interface',
    description: t('keep_quick_access_to_emdash_while_agents'),
    keywords: ['menu bar', 'system tray', 'task bar', 'icon', 'hide', 'disable'],
  },
  {
    id: 'color-mode',
    label: t('color_mode'),
    tab: 'interface',
    description: t('choose_how_emdash_looks'),
    keywords: ['theme', 'dark mode', 'light mode', 'appearance', 'system'],
  },
  {
    id: 'default-terminal-shell',
    label: t('default_terminal_shell'),
    tab: 'interface',
    description: t('used_for_new_local_terminals'),
    keywords: ['bash', 'zsh', 'fish'],
  },
  {
    id: 'terminal-font',
    label: t('terminal_font'),
    tab: 'interface',
    description: t('choose_the_font_family_for_the_terminal'),
    keywords: ['font family', 'menlo'],
  },
  {
    id: 'terminal-font-size',
    label: t('terminal_font_size_2'),
    tab: 'interface',
    description: t('adjust_the_font_size_used_by_terminal_se'),
    keywords: ['text size', 'zoom'],
  },
  {
    id: 'auto-copy-selected-text',
    label: t('auto_copy_selected_text'),
    tab: 'interface',
    description: t('automatically_copy_text_to_clipboard_whe'),
    keywords: ['clipboard', 'terminal'],
  },
  {
    id: 'use-option-as-meta-key',
    label: t('use_option_as_meta_key'),
    tab: 'interface',
    description: t('treat_the_option_key_as_the_meta_key_in_'),
    keywords: ['macos', 'alt', 'terminal'],
  },
  {
    id: 'left-sidebar-line-changes',
    label: t('left_sidebar_line_changes_2'),
    tab: 'interface',
    description: t('show_added_and_removed_line_counts_for_t'),
    keywords: ['diff'],
  },
  {
    id: 'left-sidebar-pr-status',
    label: t('left_sidebar_pr_status'),
    tab: 'interface',
    description: t('show_github_pr_merge_and_status_icons_fo'),
    keywords: ['pull request'],
  },
  {
    id: 'left-sidebar-timestamps',
    label: t('left_sidebar_timestamps'),
    tab: 'interface',
    description: t('show_the_relative_task_timestamp_in_the_'),
    keywords: ['time'],
  },
  {
    id: 'resource-monitor',
    label: t('resource_monitor'),
    tab: 'interface',
    description: t('track_cpu_and_memory_usage_for_running_a'),
    keywords: ['cpu', 'memory', 'performance'],
  },
  {
    id: 'context-bar',
    label: t('context_bar'),
    tab: 'interface',
    description: t('hide_the_on_screen_context_trigger'),
  },
  {
    id: 'keyboard-shortcuts',
    label: t('keyboard_shortcuts'),
    tab: 'interface',
    description: t('rebind_reset_or_remove_app_keyboard_shor'),
    keywords: ['hotkeys', 'keybindings', 'rebind'],
  },
  {
    id: 'open-in-tools',
    label: 'Tools',
    tab: 'interface',
    description: 'Show or hide detected "Open in" apps in menus.',
    keywords: ['open in', 'editor', 'hidden tools'],
  },
  // Browser
  {
    id: 'default-browser-profile',
    label: t('default_browser_profile'),
    tab: 'browser',
    description: t('new_browser_tabs_open_with_this_profile'),
    keywords: ['isolated'],
  },
  {
    id: 'disable-cors-for-localhost',
    label: t('disable_cors_for_localhost'),
    tab: 'browser',
    description: t('allow_localhost_pages_in_emdash_browser_'),
    keywords: ['cross-origin'],
  },
  {
    id: 'browser-profiles',
    label: t('browser_profiles_2'),
    tab: 'browser',
    description: t('each_profile_keeps_its_own_cookies_and_l'),
    keywords: ['cookies', 'logins'],
  },
  {
    id: 'browsing-data',
    label: t('browsing_data'),
    tab: 'browser',
    description: t('clear_cookies_cached_files_and_site_data'),
    keywords: ['cookies', 'cache', 'clear', 'site data'],
  },
];

function normalizeQuery(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function entryMatchesTokens(entry: SettingsSearchEntry, tokens: string[]): boolean {
  const haystack = [entry.label, entry.description ?? '', ...(entry.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/** All index entries matching the query. An empty/whitespace query matches nothing. */
export function searchSettings(
  query: string,
  index: SettingsSearchEntry[] = SETTINGS_SEARCH_INDEX
): SettingsSearchEntry[] {
  const tokens = normalizeQuery(query);
  if (tokens.length === 0) return [];
  return index.filter((entry) => entryMatchesTokens(entry, tokens));
}

/** Tabs containing at least one match, in sidebar order. */
export function matchedTabsForQuery(
  query: string,
  index: SettingsSearchEntry[] = SETTINGS_SEARCH_INDEX
): SettingsPageTab[] {
  const matchedTabs = new Set(searchSettings(query, index).map((entry) => entry.tab));
  return settingsPageContributions
    .filter((page) => matchedTabs.has(page.id))
    .map((page) => page.id);
}
