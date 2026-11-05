import { ReviewResult } from '@cr/shared';

export class MarkdownReporter {
  format(result: ReviewResult): string {
    const { summary, findings } = result;
    const lines: string[] = [];

    lines.push(`# Code Review Report — \`cr\``);
    lines.push('');
    lines.push(`> **Target:** \`${summary.target.type}\` | **Mode:** \`${summary.executionMode}\` | **Model:** \`${summary.modelName}\` | **Date:** \`${summary.timestamp}\``);
    lines.push('');

    // Summary Table
    lines.push(`## Summary Overview`);
    lines.push('');
    lines.push(`| Severity | Count | Category | Count |`);
    lines.push(`| :--- | :--- | :--- | :--- |`);
    lines.push(`| 🔴 Critical | **${summary.bySeverity.critical ?? 0}** | 🐛 Bug | ${summary.byCategory.bug ?? 0} |`);
    lines.push(`| 🟠 Major | **${summary.bySeverity.major ?? 0}** | 🛡️ Security | ${summary.byCategory.security ?? 0} |`);
    lines.push(`| 🟡 Minor | **${summary.bySeverity.minor ?? 0}** | ⚡ Performance | ${summary.byCategory.performance ?? 0} |`);
    lines.push(`| ⚪ Info | **${summary.bySeverity.info ?? 0}** | 📐 Architecture | ${summary.byCategory.architecture ?? 0} |`);
    lines.push('');

    if (findings.length === 0) {
      lines.push(`### ✅ All Verification Gates Passed`);
      lines.push(`No critical, security, performance, or quality issues detected in analyzed hunks.`);
      return lines.join('\n');
    }

    lines.push(`## Detailed Findings (${findings.length})`);
    lines.push('');

    for (const f of findings) {
      lines.push(`### \`[${f.id}]\` ${f.title}`);
      lines.push('');
      lines.push(`- **Location:** \`${f.filePath}:${f.startLine}-${f.endLine}\``);
      lines.push(`- **Severity:** \`${f.severity}\` | **Category:** \`${f.category}\` | **Confidence:** \`${(f.confidence * 100).toFixed(0)}%\``);
      lines.push(`- **Verified By:** \`${f.verifiedBy.join(', ')}\``);
      lines.push('');
      lines.push(`**Explanation:**`);
      lines.push(f.explanation);
      lines.push('');

      if (f.evidence) {
        lines.push(`**Evidence:**`);
        lines.push('```');
        lines.push(f.evidence);
        lines.push('```');
        lines.push('');
      }

      if (f.suggestedPatch) {
        lines.push(`**Suggested Patch:**`);
        lines.push('```diff');
        lines.push(f.suggestedPatch);
        lines.push('```');
        lines.push('');
      }

      if (f.suggestedTest) {
        lines.push(`**Suggested Test:**`);
        lines.push('```typescript');
        lines.push(f.suggestedTest);
        lines.push('```');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}
