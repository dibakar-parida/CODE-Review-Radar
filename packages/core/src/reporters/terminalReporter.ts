import { ReviewResult, ReviewFinding } from '@cr/shared';

// ANSI escape sequences for cross-platform zero-dependency terminal styling
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  lime: '\x1b[38;2;57;255;20m',
  purple: '\x1b[38;2;191;0;255m',
  pink: '\x1b[38;2;255;20;147m',
  cyan: '\x1b[38;2;0;255;255m',
  amber: '\x1b[38;2;255;170;0m',
  rose: '\x1b[38;2;255;0;110m',
  bgDark: '\x1b[48;2;20;20;20m',
  white: '\x1b[97m',
};

export class TerminalReporter {
  format(result: ReviewResult): string {
    const { summary, findings } = result;
    const lines: string[] = [];

    // Header banner
    lines.push('');
    lines.push(`${c.bold}${c.lime}⚡ cr — AI Code Review Radar${c.reset}`);
    lines.push(`${c.dim}─────────────────────────────────────────────────────────────────${c.reset}`);
    lines.push(
      `Target: ${c.bold}${summary.target.type}${c.reset}  |  Mode: ${c.cyan}${summary.executionMode}${c.reset}  |  Model: ${c.white}${summary.modelName}${c.reset}`
    );
    lines.push(
      `Files Analyzed: ${c.bold}${summary.filesAnalyzed}${c.reset}  |  Duration: ${c.bold}${summary.durationMs}ms${c.reset}`
    );
    lines.push(`${c.dim}─────────────────────────────────────────────────────────────────${c.reset}`);

    // Summary Metric Counters
    lines.push('');
    lines.push(`${c.bold}FINDING SUMMARY:${c.reset}`);
    lines.push(
      `  ${c.rose}● Critical: ${summary.bySeverity.critical ?? 0}${c.reset}   ` +
        `  ${c.amber}● Major: ${summary.bySeverity.major ?? 0}${c.reset}   ` +
        `  ${c.cyan}● Minor: ${summary.bySeverity.minor ?? 0}${c.reset}   ` +
        `  ${c.dim}● Info: ${summary.bySeverity.info ?? 0}${c.reset}`
    );
    lines.push('');

    if (findings.length === 0) {
      lines.push(`${c.lime}✔ No issues detected! Clean diff passed all verification gates.${c.reset}`);
      lines.push('');
      return lines.join('\n');
    }

    // Individual Findings
    lines.push(`${c.bold}DETAILED FINDINGS (${findings.length}):${c.reset}`);
    lines.push('');

    for (const finding of findings) {
      lines.push(this.formatFinding(finding));
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatFinding(finding: ReviewFinding): string {
    const lines: string[] = [];
    const severityColor =
      finding.severity === 'critical'
        ? c.rose
        : finding.severity === 'major'
          ? c.amber
          : finding.severity === 'minor'
            ? c.cyan
            : c.dim;

    const idTag = `${c.bold}${severityColor}[${finding.id}]${c.reset}`;
    const categoryTag = `${c.dim}${finding.category.toUpperCase()} · ${finding.severity.toUpperCase()}${c.reset}`;
    const confidenceTag = `${c.cyan}(conf: ${(finding.confidence * 100).toFixed(0)}%)${c.reset}`;

    lines.push(`${idTag} ${c.bold}${finding.title}${c.reset} ${confidenceTag}`);
    lines.push(`  ${c.dim}Location:${c.reset} ${c.white}${finding.filePath}:${finding.startLine}-${finding.endLine}${c.reset}  ${categoryTag}`);
    lines.push(`  ${c.dim}Verified by:${c.reset} [${finding.verifiedBy.join(', ')}]`);
    lines.push('');
    lines.push(`  ${finding.explanation}`);

    if (finding.evidence) {
      lines.push('');
      lines.push(`  ${c.dim}Evidence:${c.reset}`);
      for (const eline of finding.evidence.split('\n')) {
        lines.push(`    ${c.dim}│${c.reset} ${eline}`);
      }
    }

    if (finding.suggestedPatch) {
      lines.push('');
      lines.push(`  ${c.lime}Suggested Patch:${c.reset}`);
      for (const pline of finding.suggestedPatch.split('\n')) {
        if (pline.startsWith('+')) {
          lines.push(`    ${c.lime}${pline}${c.reset}`);
        } else if (pline.startsWith('-')) {
          lines.push(`    ${c.rose}${pline}${c.reset}`);
        } else {
          lines.push(`    ${c.dim}${pline}${c.reset}`);
        }
      }
    }

    return lines.join('\n');
  }
}
