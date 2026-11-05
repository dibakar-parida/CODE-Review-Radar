import {
  WebhookEvent,
  WebhookCheckRunResponse,
  WebhookAnnotation,
  ReviewResult,
  ReviewFinding,
} from '@cr/shared';

export class WebhookEmulator {
  /**
   * Parses raw incoming webhook payload from GitHub or GitLab into a normalized WebhookEvent.
   */
  static parsePayload(
    payload: Record<string, any>,
    headers: Record<string, string | string[] | undefined> = {}
  ): WebhookEvent {
    // 1. Detect GitHub Webhooks
    const githubEvent = (headers['x-github-event'] || headers['X-GitHub-Event']) as string | undefined;
    if (githubEvent || payload.pull_request || payload.head_commit) {
      if (payload.pull_request) {
        return {
          provider: 'github',
          event: `pull_request.${payload.action || 'opened'}`,
          repoName: payload.repository?.full_name || payload.repository?.name || 'unknown/repo',
          branch: payload.pull_request.head?.ref || 'main',
          baseBranch: payload.pull_request.base?.ref || 'main',
          commitSha: payload.pull_request.head?.sha,
          sender: payload.sender?.login,
          prNumber: payload.pull_request.number,
        };
      }

      // Push event
      const branchRef = payload.ref || 'refs/heads/main';
      const branchName = branchRef.replace(/^refs\/heads\//, '');
      return {
        provider: 'github',
        event: 'push',
        repoName: payload.repository?.full_name || payload.repository?.name || 'unknown/repo',
        branch: branchName,
        baseBranch: 'main',
        commitSha: payload.after || payload.head_commit?.id,
        sender: payload.sender?.login || payload.pusher?.name,
      };
    }

    // 2. Detect GitLab Webhooks
    const gitlabEvent = (headers['x-gitlab-event'] || headers['X-Gitlab-Event']) as string | undefined;
    if (gitlabEvent || payload.object_kind) {
      if (payload.object_kind === 'merge_request') {
        const mr = payload.object_attributes || {};
        return {
          provider: 'gitlab',
          event: `merge_request.${mr.action || 'opened'}`,
          repoName: payload.project?.path_with_namespace || payload.project?.name || 'unknown/repo',
          branch: mr.source_branch || 'main',
          baseBranch: mr.target_branch || 'main',
          commitSha: mr.last_commit?.id,
          sender: payload.user?.username,
          prNumber: mr.iid,
        };
      }

      // GitLab push event
      const branchRef = payload.ref || 'refs/heads/main';
      const branchName = branchRef.replace(/^refs\/heads\//, '');
      return {
        provider: 'gitlab',
        event: 'push',
        repoName: payload.project?.path_with_namespace || payload.project?.name || 'unknown/repo',
        branch: branchName,
        baseBranch: 'main',
        commitSha: payload.checkout_sha || payload.after,
        sender: payload.user_username,
      };
    }

    // Generic fallback
    return {
      provider: 'generic',
      event: payload.event || 'custom_event',
      repoName: payload.repoName || 'local-repo',
      branch: payload.branch || 'main',
      baseBranch: payload.baseBranch || 'main',
      commitSha: payload.commitSha,
      sender: payload.sender,
      prNumber: payload.prNumber,
    };
  }

  /**
   * Formats a completed ReviewResult into GitHub / GitLab Check Run API annotations and summary.
   */
  static formatCheckRun(event: WebhookEvent, result: ReviewResult): WebhookCheckRunResponse {
    const critical = result.summary.bySeverity.critical ?? 0;
    const major = result.summary.bySeverity.major ?? 0;
    const isPassing = critical === 0 && major === 0;

    const annotations: WebhookAnnotation[] = result.findings.map((f: ReviewFinding) => {
      let level: 'failure' | 'warning' | 'notice' = 'notice';
      if (f.severity === 'critical') level = 'failure';
      else if (f.severity === 'major') level = 'warning';

      return {
        path: f.filePath,
        start_line: f.startLine,
        end_line: f.endLine,
        annotation_level: level,
        title: `[${f.category.toUpperCase()}] ${f.title}`,
        message: f.explanation,
        raw_details: f.suggestedPatch || f.evidence || undefined,
      };
    });

    const title = isPassing
      ? `✔ cr: All Review Checks Passed (${event.branch} ➔ ${event.baseBranch})`
      : `✖ cr: ${critical + major} Blocking Issue(s) Detected (${event.branch} ➔ ${event.baseBranch})`;

    const summary = [
      `### Review Result for \`${event.repoName}\` (\`${event.branch}\`)`,
      `- **Status:** ${isPassing ? 'SUCCESS' : 'FAILURE'}`,
      `- **Files Analyzed:** ${result.summary.filesAnalyzed}`,
      `- **Total Findings:** ${result.summary.totalFindings} (Critical: ${critical}, Major: ${major}, Minor: ${result.summary.bySeverity.minor})`,
      `- **Execution Duration:** ${result.summary.durationMs}ms`,
    ].join('\n');

    return {
      status: 'completed',
      conclusion: isPassing ? 'success' : 'failure',
      title,
      summary,
      annotationsCount: annotations.length,
      annotations,
    };
  }
}
