import { ReviewResult } from '@cr/shared';

export class HtmlReporter {
  format(result: ReviewResult): string {
    const { summary, findings } = result;

    const findingsHtml = findings
      .map(
        (f) => `
      <article class="finding-card">
        <div class="finding-header">
          <span class="finding-id">${f.id}</span>
          <span class="badge ${f.severity}">${f.severity}</span>
          <span class="badge category">${f.category}</span>
          <span class="coord">${f.filePath}:${f.startLine}-${f.endLine}</span>
          <span class="conf">conf: ${(f.confidence * 100).toFixed(0)}%</span>
        </div>
        <h3 class="finding-title">${this.escapeHtml(f.title)}</h3>
        <p class="finding-desc">${this.escapeHtml(f.explanation)}</p>
        ${
          f.evidence
            ? `<div class="code-well"><pre><code>${this.escapeHtml(f.evidence)}</code></pre></div>`
            : ''
        }
        ${
          f.suggestedPatch
            ? `<div class="patch-well"><div class="well-title">Suggested Patch</div><pre><code>${this.escapeHtml(
                f.suggestedPatch
              )}</code></pre></div>`
            : ''
        }
      </article>`
      )
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>cr — Code Review Report</title>
  <style>
    :root {
      --vb-lime: #39FF14;
      --vb-purple: #BF00FF;
      --vb-pink: #FF1493;
      --vb-cyan: #00FFFF;
      --vb-amber: #FFAA00;
      --vb-rose: #FF006E;
      --vb-bg: #0D0D0D;
    }
    body {
      background: var(--vb-bg);
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 3rem; font-weight: 900; margin-bottom: 0.5rem; }
    .meta { color: #888; font-family: monospace; font-size: 0.9rem; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 3rem; }
    .metric { padding: 1.5rem; border-radius: 1rem; color: #000; font-weight: 900; }
    .metric.critical { background: var(--vb-rose); color: #FFF; }
    .metric.major { background: var(--vb-amber); }
    .metric.minor { background: var(--vb-cyan); }
    .metric.files { background: var(--vb-lime); }
    .metric .num { font-size: 2.5rem; }
    .metric .label { font-size: 0.8rem; text-transform: uppercase; }
    .finding-card { background: #141414; border: 1px solid #262626; border-left: 6px solid var(--vb-pink); border-radius: 1rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    .finding-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; font-family: monospace; font-size: 0.85rem; flex-wrap: wrap; }
    .finding-id { background: var(--vb-pink); color: #000; font-weight: bold; padding: 0.2rem 0.5rem; border-radius: 0.25rem; }
    .badge { padding: 0.2rem 0.5rem; border-radius: 0.25rem; text-transform: uppercase; font-weight: bold; }
    .badge.critical { background: #380015; color: var(--vb-rose); border: 1px solid var(--vb-rose); }
    .badge.major { background: #332200; color: var(--vb-amber); border: 1px solid var(--vb-amber); }
    .badge.minor { background: #002233; color: var(--vb-cyan); border: 1px solid var(--vb-cyan); }
    .badge.category { background: #222; color: #BBB; }
    .coord { color: #AAA; }
    .conf { color: var(--vb-lime); margin-left: auto; }
    .finding-title { font-size: 1.25rem; font-weight: 800; margin: 0 0 0.5rem 0; }
    .finding-desc { color: #CCC; line-height: 1.5; margin-bottom: 1rem; }
    .code-well, .patch-well { background: #080808; border: 1px solid #222; border-radius: 0.5rem; padding: 1rem; overflow-x: auto; font-family: monospace; font-size: 0.85rem; margin-top: 0.5rem; }
    .well-title { color: var(--vb-lime); font-size: 0.75rem; text-transform: uppercase; font-weight: bold; margin-bottom: 0.5rem; }
    pre { margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>cr review radar</h1>
    <div class="meta">
      Target: <b>${summary.target.type}</b> | Mode: <b>${summary.executionMode}</b> | Model: <b>${summary.modelName}</b> | Generated: ${summary.timestamp}
    </div>
    <div class="grid">
      <div class="metric critical">
        <div class="num">${summary.bySeverity.critical ?? 0}</div>
        <div class="label">Critical Findings</div>
      </div>
      <div class="metric major">
        <div class="num">${summary.bySeverity.major ?? 0}</div>
        <div class="label">Major Refactors</div>
      </div>
      <div class="metric minor">
        <div class="num">${summary.bySeverity.minor ?? 0}</div>
        <div class="label">Minor / Smells</div>
      </div>
      <div class="metric files">
        <div class="num">${summary.filesAnalyzed}</div>
        <div class="label">Files Analyzed</div>
      </div>
    </div>
    <h2>Detailed Findings (${findings.length})</h2>
    ${findingsHtml || '<p style="color: var(--vb-lime)">✔ Clean diff. No issues detected!</p>'}
  </div>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
