/**
 * Prints a Markdown summary of a quality gate for the GitHub job summary.
 *   tsx scripts/ci-summary.ts coverage   (reads reports/coverage/coverage-summary.json)
 *   tsx scripts/ci-summary.ts mutation   (reads reports/mutation/mutation.json)
 */
import { existsSync, readFileSync } from 'node:fs';

type Metric = { pct: number; covered: number; total: number };

function coverage(): string {
  const file = 'reports/coverage/coverage-summary.json';
  if (!existsSync(file)) return '### Coverage\n\nNo coverage report was produced.\n';
  const { total } = JSON.parse(readFileSync(file, 'utf8')) as { total: Record<string, Metric> };
  const rows = ['lines', 'branches', 'functions', 'statements'].map((key) => {
    const m = total[key]!;
    return `| ${key} | ${m.pct.toFixed(2)} % | ${m.covered} / ${m.total} |`;
  });
  return [
    '### Coverage (unit + integration)',
    '',
    '| Metric | % | Covered |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function mutation(): string {
  const file = 'reports/mutation/mutation.json';
  if (!existsSync(file)) return '### Mutation testing\n\nNo mutation report was produced.\n';
  const report = JSON.parse(readFileSync(file, 'utf8')) as {
    files: Record<string, { mutants: { status: string }[] }>;
  };
  const rows: string[] = [];
  let detected = 0;
  let valid = 0;
  for (const [name, { mutants }] of Object.entries(report.files)) {
    const counted = mutants.filter(
      (m) => !['CompileError', 'RuntimeError', 'Ignored'].includes(m.status),
    );
    const killed = counted.filter((m) => m.status === 'Killed' || m.status === 'Timeout').length;
    detected += killed;
    valid += counted.length;
    const score = counted.length ? ((killed / counted.length) * 100).toFixed(1) : 'n/a';
    rows.push(`| \`${name}\` | ${score} % | ${counted.length - killed} |`);
  }
  const overall = valid ? ((detected / valid) * 100).toFixed(2) : 'n/a';
  return [
    `### Mutation score: ${overall} %`,
    '',
    '| File | Score | Survived |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

const kind = process.argv[2];
if (kind === 'coverage') console.log(coverage());
else if (kind === 'mutation') console.log(mutation());
else {
  console.error('Usage: tsx scripts/ci-summary.ts <coverage|mutation>');
  process.exit(1);
}
