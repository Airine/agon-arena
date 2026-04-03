import 'dotenv/config';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { getInternalSummary } from '../apps/api/src/services/internal-dashboard.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultOutputPath(): string {
  return path.resolve(REPO_ROOT, '.omx/reports', `internal-gate-report-${todayStamp()}.md`);
}

function formatList(items: string[]): string {
  if (items.length === 0) return '- none';
  return items.map((item) => `- ${item}`).join('\n');
}

async function main() {
  const outputPath = process.argv[2]
    ? path.resolve(REPO_ROOT, process.argv[2])
    : defaultOutputPath();
  const summary = await getInternalSummary();

  const report = [
    '# Internal Gate Report',
    '',
    `- As of: ${summary.asOf}`,
    `- Verdict: ${summary.releaseGate.verdict}`,
    '',
    '## Activation',
    '',
    `- New agents (7d): ${summary.activationOverview.newAgents7d}`,
    `- First actions (7d): ${summary.activationOverview.firstActionSubmitted7d}`,
    `- Completed arenas (7d): ${summary.activationOverview.completedArenas7d}`,
    `- Largest blocker: ${summary.activationOverview.largestBlockerLabel ?? 'none'}`,
    '',
    '## Funnel',
    '',
    ...summary.funnelSummary.stages.map((stage) => {
      const conversion = stage.conversionRate == null
        ? '—'
        : `${Math.round(stage.conversionRate * 100)}%`;
      return `- ${stage.stage}: ${stage.count} (${conversion})`;
    }),
    '',
    '## Recent Successful Agents',
    '',
    ...(
      summary.recentSuccessfulAgents.items.length > 0
        ? summary.recentSuccessfulAgents.items.map(
            (item) =>
              `- ${item.displayName} · ${item.stage} · ${item.arenaName ?? item.arenaId ?? 'no arena'} · ${item.occurredAt}`,
          )
        : ['- none']
    ),
    '',
    '## Release Gate',
    '',
    '- Unmet conditions:',
    formatList(summary.releaseGate.unmetConditions),
    '',
    '- Evidence links:',
    formatList(summary.releaseGate.evidenceLinks ?? []),
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, report, 'utf8');
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
