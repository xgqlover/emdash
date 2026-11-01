import type { PullRequest, PullRequestCheck } from '@emdash/plugins/pull-requests/schemas';
import { computeCheckRunsSummary } from '@core/features/github/api/browser/checks';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export type MergeSeverity = 'success' | 'warning' | 'error' | 'neutral';
export type MergeCheckState = 'pending' | 'failed' | 'passing' | 'unknown';

export type MergeUiState = {
  kind: 'ready' | 'draft' | 'conflicts' | 'behind' | 'blocked' | 'unstable' | 'unknown';
  severity: MergeSeverity;
  title: string;
  detail?: string;
  canMerge: boolean;
  canBypassRequirements: boolean;
};

export function deriveMergeCheckState(checks: PullRequestCheck[]): MergeCheckState {
  const summary = computeCheckRunsSummary(checks);
  if (summary.failed > 0) return 'failed';
  if (summary.pending > 0) return 'pending';
  if (summary.passed > 0) return 'passing';
  return 'unknown';
}

export function computeMergeUiState(pr: PullRequest): MergeUiState {
  const providerName = pr.provider === 'gitlab' ? 'GitLab' : 'GitHub';
  const short = pr.provider === 'gitlab' ? 'MR' : 'PR';
  const canBypass = pr.provider !== 'gitlab';
  if (pr.status !== 'open') {
    return {
      kind: 'unknown',
      severity: 'neutral',
      title: t('merge_status_unknown'),
      detail: `Refresh ${short} status and try again.`,
      canMerge: false,
      canBypassRequirements: false,
    };
  }
  if (pr.isDraft) {
    return {
      kind: 'draft',
      severity: 'neutral',
      title: pr.provider === 'gitlab' ? 'Draft merge request' : 'Draft pull request',
      detail: 'Mark ready for review to enable merging.',
      canMerge: false,
      canBypassRequirements: false,
    };
  }
  switch (pr.mergeStateStatus) {
    case 'CLEAN':
      return {
        kind: 'ready',
        severity: 'success',
        title: t('ready_to_merge'),
        detail: 'No conflicts or required reviews.',
        canMerge: true,
        canBypassRequirements: false,
      };
    case 'DIRTY':
      return {
        kind: 'conflicts',
        severity: 'error',
        title: t('merge_conflicts'),
        detail: 'Resolve conflicts before merging.',
        canMerge: false,
        canBypassRequirements: false,
      };
    case 'BEHIND':
      return {
        kind: 'behind',
        severity: 'warning',
        title: t('branch_is_out_of_date'),
        detail:
          pr.provider === 'gitlab'
            ? 'Rebase the source branch before merging.'
            : 'Update the branch, or merge without waiting if your account can bypass rules.',
        canMerge: false,
        canBypassRequirements: canBypass,
      };
    case 'BLOCKED':
      return {
        kind: 'blocked',
        severity: 'error',
        title: t('merging_is_blocked'),
        detail: 'Required reviews, checks, or branch rules are not satisfied.',
        canMerge: false,
        canBypassRequirements: canBypass,
      };
    case 'HAS_HOOKS':
      return {
        kind: 'blocked',
        severity: 'error',
        title: t('merging_is_blocked'),
        detail: 'Required checks are not satisfied.',
        canMerge: false,
        canBypassRequirements: canBypass,
      };
    case 'UNSTABLE':
      switch (
        pr.checkSummary === undefined
          ? deriveMergeCheckState(pr.checks)
          : pr.checkSummary === 'SUCCESS'
            ? 'passing'
            : pr.checkSummary === 'FAILURE' || pr.checkSummary === 'ERROR'
              ? 'failed'
              : pr.checkSummary === 'PENDING' || pr.checkSummary === 'EXPECTED'
                ? 'pending'
                : 'unknown'
      ) {
        case 'pending':
          return {
            kind: 'unstable',
            severity: 'warning',
            title: t('checks_still_running'),
            detail: `Waiting for ${providerName} checks to finish.`,
            canMerge: false,
            canBypassRequirements: canBypass,
          };
        case 'failed':
          return {
            kind: 'unstable',
            severity: 'warning',
            title: t('checks_not_passing'),
            detail: 'Review failing checks before merging.',
            canMerge: false,
            canBypassRequirements: canBypass,
          };
        case 'passing':
          return {
            kind: 'unstable',
            severity: 'warning',
            title: `Checks passing, but ${short} is unstable`,
            detail: `${providerName} still reports the branch as unstable. Review branch rules before merging.`,
            canMerge: false,
            canBypassRequirements: canBypass,
          };
        case 'unknown':
          return {
            kind: 'unstable',
            severity: 'warning',
            title: t('checks_pending_or_not_passing'),
            detail: `Review ${providerName} checks before merging.`,
            canMerge: false,
            canBypassRequirements: canBypass,
          };
      }
    default:
      return {
        kind: 'unknown',
        severity: 'neutral',
        title: t('merge_status_unknown'),
        detail: 'Refresh to try again.',
        canMerge: false,
        canBypassRequirements: false,
      };
  }
}
