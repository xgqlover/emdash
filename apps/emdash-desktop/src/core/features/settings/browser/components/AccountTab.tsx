import { t } from '@renderer/lib/i18n';
import { Button, useToast } from '@emdash/ui/react/primitives';
import { Loader2, LogIn, LogOut, User } from 'lucide-react';
import { useState } from 'react';
import {
  useAccountHealth,
  useAccountSession,
  useAccountSignIn,
  useAccountSignOut,
} from '@core/features/account/api/browser/useAccount';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { ServerUnavailableMessage } from './ServerUnavailableMessage';

export function AccountTab() {
  const { data: session, isLoading } = useAccountSession();
  const { data: serverAvailable } = useAccountHealth();
  const signInMutation = useAccountSignIn();
  const signOutMutation = useAccountSignOut();
  const { toast } = useToast();
  const openConfirmSignOut = useOpenModal('confirmActionModal');
  const [error, setError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const isSignedIn = session?.isSignedIn ?? false;
  const hasAccount = session?.hasAccount ?? false;
  const displayName = user?.name?.trim() || user?.username || '';

  const handleSignIn = async () => {
    setError(null);
    try {
      const result = await signInMutation.mutateAsync(undefined);
      if (!result.success) {
        const message = result.error || 'Sign in failed';
        setError(message);
        toast.error('Sign in failed', { description: message });
        return;
      }
      toast('Signed in to Emdash', {
        description: result.user
          ? `Connected as ${result.user.name?.trim() || result.user.username}`
          : 'Signed in',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      setError(message);
      toast.error('Sign in failed', { description: message });
    }
  };

  const performSignOut = async () => {
    try {
      await signOutMutation.mutateAsync();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign out failed';
      toast.error('Sign out failed', { description: message });
    }
  };

  const handleSignOut = () => {
    void openConfirmSignOut({
      title: t('sign_out_confirm'),
      description: t('sign_out_desc'),
      confirmLabel: 'Sign Out',
      variant: 'default',
    }).then((outcome) => {
      if (outcome.success) void performSignOut();
    });
  };

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('loading_account')}
      </div>
    );
  }

  if (isSignedIn && user) {
    return (
      <div className="flex items-center gap-3">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={displayName}
            className="h-10 w-10 rounded-full border border-border/60"
          />
        ) : (
          <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full border border-border/60">
            <User className="text-muted-foreground h-6 w-6" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">{displayName}</p>
          {user.email && <p className="text-xs text-foreground-muted">{user.email}</p>}
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={handleSignOut}
          disabled={signOutMutation.isPending}
        >
          <LogOut className="h-3.5 w-3.5" />
          {t('sign_out')}
        </Button>
      </div>
    );
  }

  if (hasAccount && !isSignedIn) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{t('session_expired')}</p>
          <p className="text-muted-foreground text-xs">
            {t('session_expired_desc')}
          </p>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
        {serverAvailable === false ? (
          <ServerUnavailableMessage />
        ) : (
          <Button
            type="button"
            className="w-fit"
            onClick={() => void handleSignIn()}
            disabled={signInMutation.isPending}
          >
            <LogIn className="h-3.5 w-3.5" />
            {signInMutation.isPending ? t('signing_in') : t('sign_in')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{t('emdash_account')}</p>
        <p className="text-muted-foreground text-xs">
          {t('emdash_account_desc')}
        </p>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      {serverAvailable === false ? (
        <ServerUnavailableMessage />
      ) : (
        <Button
          type="button"
          className="w-fit"
          onClick={() => void handleSignIn()}
          disabled={signInMutation.isPending}
        >
          <LogIn className="h-3.5 w-3.5" />
          {signInMutation.isPending ? t('creating_account') : t('create_account')}
        </Button>
      )}
    </div>
  );
}
