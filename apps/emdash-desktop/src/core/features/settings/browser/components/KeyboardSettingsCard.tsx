import { t } from '@renderer/lib/i18n';
import { SettingsCard } from '@emdash/ui/react/patterns';
import { Button, toast, Tooltip } from '@emdash/ui/react/primitives';
import { RotateCcw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { SCOPE_CATALOG } from '@core/manifests/browser/scope-catalog';
import { COMMAND_CATALOG } from '@core/manifests/shared/command-catalog';
import {
  CODE_TO_US_CHAR,
  detectPlatformContext,
  findConflicts,
  keybinding,
  type Chord,
  type KeybindingEntry,
} from '@core/primitives/keybindings/api';
import {
  keyboardLayoutService,
  keybindingService,
  useChordRecorder,
} from '@core/primitives/keybindings/browser';
import { Shortcut } from '@core/primitives/keybindings/browser/shortcut';

const groupsByCommandId = new Map<string, string[]>();
for (const scope of SCOPE_CATALOG) {
  for (const command of scope.commands) {
    const groups = groupsByCommandId.get(command.id) ?? [];
    groups.push(scope.id);
    groupsByCommandId.set(command.id, groups);
  }
}

const CONFLICT_ENTRIES: readonly KeybindingEntry[] = COMMAND_CATALOG.defs.flatMap((command) =>
  command.keybinding
    ? [
        {
          id: command.id,
          groups: groupsByCommandId.get(command.id),
          binding: command.keybinding,
        },
      ]
    : []
);

const SYSTEM_HIDE_ENTRY: KeybindingEntry = {
  id: 'system.hide',
  groups: [],
  binding: keybinding.fixed('Mod+H'),
};

const KeyboardSettingsCard: React.FC = observer(function KeyboardSettingsCard() {
  const {
    value: keyboard,
    update,
    isLoading: loading,
    isSaving: saving,
    resetField,
  } = useAppSettingsKey('keyboard');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const groups = keybindingService.settingsEntries();
  const platform = detectPlatformContext();

  const recorder = useChordRecorder({
    onRecord: (candidate: Chord) => {
      const editingEntry = groups
        .flatMap((group) => group.entries)
        .find((entry) => entry.binding.settingsKey === editingKey);
      if (!editingEntry || !editingKey) return;

      const conflicts = findConflicts(
        platform.os === 'mac' ? [...CONFLICT_ENTRIES, SYSTEM_HIDE_ENTRY] : CONFLICT_ENTRIES,
        candidate,
        editingEntry.command.id,
        keyboard ?? {},
        platform,
        keyboardLayoutService.codeToCharMap() ?? CODE_TO_US_CHAR
      );
      const rejected = conflicts.find(
        (conflict) => conflict.severity === 'reserved' || conflict.severity === 'error'
      );
      if (rejected) {
        const conflictingTitle =
          COMMAND_CATALOG.byId(rejected.id)?.title ??
          (rejected.id === SYSTEM_HIDE_ENTRY.id ? 'Hide Emdash' : rejected.id);
        toast.error(
          rejected.severity === 'reserved' ? t('shortcut_reserved') : t('shortcut_conflict'),
          { description: t('shortcut_conflict_desc', { title: conflictingTitle }) }
        );
        setEditingKey(null);
        return;
      }

      update({ [editingKey]: candidate });
      const shadowing = conflicts.find((conflict) => conflict.severity === 'shadowing');
      const label = keyboardLayoutService.displayLabel(candidate, platform).join(' + ');
      toast(t('shortcut_updated'), {
        description: shadowing
          ? `${editingEntry.command.title} is now ${label}. It shadows ${
              COMMAND_CATALOG.byId(shadowing.id)?.title ?? shadowing.id
            } in some contexts.`
          : `${editingEntry.command.title} is now ${label}.`,
      });
      setEditingKey(null);
    },
    onCancel: () => setEditingKey(null),
  });

  const startCapture = (settingsKey: string) => {
    setEditingKey(settingsKey);
    recorder.startRecording();
  };

  return (
    <SettingsCard>
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.category}>
            <div className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">
              {group.category}
            </div>
            <div className="space-y-3">
              {group.entries.map((entry) => {
                const key = entry.binding.settingsKey;
                const capturing = editingKey === key && recorder.isRecording;
                const cleared = keyboard?.[key] === null;
                const showReset = keyboard?.[key] !== undefined;
                const showClear = !cleared;
                return (
                  <div
                    key={entry.command.id}
                    className="group/shortcut flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-2"
                  >
                    <div className="min-w-0 flex-1 basis-64 space-y-1">
                      <div className="text-sm wrap-break-word">{entry.command.title}</div>
                      <div className="text-muted-foreground text-xs wrap-break-word">
                        {entry.command.description}
                      </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      {capturing ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="min-w-[80px] animate-pulse"
                            onClick={recorder.cancelRecording}
                            disabled={saving}
                          >
                            {t('press_keys')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={recorder.cancelRecording}
                            disabled={saving}
                          >
                            {t('cancel')}
                          </Button>
                        </>
                      ) : (
                        <>
                          {(showClear || showReset) && (
                            <div className="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity group-hover/shortcut:pointer-events-auto group-hover/shortcut:opacity-100">
                              <Tooltip.Provider delay={150}>
                                {showReset && (
                                  <Tooltip.Root>
                                    <Tooltip.Trigger>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        icon
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                          resetField(key);
                                          toast(t('shortcut_reset'), {
                                            description: t('shortcut_reset_desc', {
                                              title: entry.command.title,
                                            }),
                                          });
                                        }}
                                        disabled={loading || saving}
                                        aria-label={t('reset_to_default')}
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </Button>
                                    </Tooltip.Trigger>
                                    <Tooltip.Content side="top">{t('reset_to_default')}</Tooltip.Content>
                                  </Tooltip.Root>
                                )}
                                {showClear && (
                                  <Tooltip.Root>
                                    <Tooltip.Trigger>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        icon
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                          update({ [key]: null });
                                          toast(t('shortcut_removed'), {
                                            description: t('shortcut_removed_desc', {
                                              title: entry.command.title,
                                            }),
                                          });
                                        }}
                                        disabled={loading || saving}
                                        aria-label={t('remove_shortcut')}
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </Button>
                                    </Tooltip.Trigger>
                                    <Tooltip.Content side="top">{t('remove_shortcut')}</Tooltip.Content>
                                  </Tooltip.Root>
                                )}
                              </Tooltip.Provider>
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-w-[80px] justify-end px-0 hover:bg-transparent"
                            onClick={() => startCapture(key)}
                            disabled={loading || saving}
                          >
                            <Shortcut hotkey={entry.chord} variant="keycaps" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </SettingsCard>
  );
});

export default KeyboardSettingsCard;
