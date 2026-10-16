// Documentation checks: run with `node scripts/check-docs.mjs` from the repository root (no dependencies).
// 1. Every relative Markdown link resolves to a file or folder.
// 2. No references to removed concepts or work-package/revision labels.
// 3. Every environment-variable style `TOKEN` named in the docs exists in the code, configuration or infrastructure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = [
  'README.md', 'TODO.md', 'contracts/README.md', 'samples/README.md', 'Validation-Service/README.md',
  ...fs.readdirSync(path.join(root, 'docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`),
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.venv', '__pycache__', 'coverage', 'test-results', 'eval-results', 'logs']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.bicep', '.bicepparam', '.ps1', '.yml', '.yaml', '.json', '.sql', '.sh', '.example', '.toml', '.conf']);

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.startsWith('.env')) yield full;
  }
}

const corpusRoots = ['Back-End', 'Front-End', 'Validation-Service', 'infra', 'scripts', '.github', 'servicebus-emulator', 'samples/tools'];
const corpusFiles = [
  ...corpusRoots.flatMap(directory => (fs.existsSync(path.join(root, directory)) ? [...walk(path.join(root, directory))] : [])),
  ...['start.ps1', 'docker-compose.yml', 'azure.yaml'].map(file => path.join(root, file)),
].filter(file => !file.endsWith('package-lock.json') && !file.endsWith('uv.lock') && !file.includes(`${path.sep}tests${path.sep}golden${path.sep}`));
const corpus = corpusFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');

// Tokens that are documented but legitimately not defined in this repository (set by Azure, azd, or the user's shell).
const EXTERNAL_TOKENS = new Set([
  'AZURE_TOKEN_CREDENTIALS', 'AZURE_ENV_NAME', 'AZURE_LOCATION', 'AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP',
  'TEST_DB_CONNECTION_STRING', 'E2E_BASE_URL', 'E2E_BROWSER_CHANNEL', 'UPDATE_GOLDEN', 'RUN_DQ_INTEGRATION_TESTS',
]);
const BANNED = [
  [/\bWP\d+\b/, 'work-package label'],
  [/368ca2c/, 'old reviewed revision'],
  [/STORAGE_PROVIDER|SHAREPOINT_|DesktopStorage|SharePointStorage/, 'removed storage provider'],
  [/\bREDIS_/, 'removed Redis setting'],
  [/Node baseline|node-baseline/, 'removed Node baseline'],
  [/solution-review-plan|implementation-plan-python-engine|greenfield-data-quality-engine|data-quality-review|rule-execution-performance/, 'removed document'],
];

const generatedIgnored = new Set(
  fs.existsSync(path.join(root, 'samples/.gitignore'))
    ? fs.readFileSync(path.join(root, 'samples/.gitignore'), 'utf8').split(/\r?\n/).filter(line => line.startsWith('/')).map(line => `samples${line}`)
    : [],
);

const problems = [];
for (const doc of docs) {
  const file = path.join(root, doc);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\]\((<[^>]+>|[^)\s]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '');
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const pathOnly = decodeURIComponent(target.split('#')[0]);
      const resolved = path.resolve(path.dirname(file), pathOnly);
      const relative = path.relative(root, resolved).split(path.sep).join('/');
      // Large sample files are git-ignored and generated on demand.
      if (pathOnly && !fs.existsSync(resolved) && !generatedIgnored.has(relative)) {
        problems.push(`${doc}:${index + 1}: broken link ${target}`);
      }
    }
    for (const [pattern, label] of BANNED) {
      if (pattern.test(line)) problems.push(`${doc}:${index + 1}: ${label}: ${line.trim().slice(0, 100)}`);
    }
    for (const match of line.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)) {
      const token = match[1];
      if (!EXTERNAL_TOKENS.has(token) && !corpus.includes(token)) {
        problems.push(`${doc}:${index + 1}: setting ${token} is not defined anywhere in the code, config or infrastructure`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`Documentation check failed (${problems.length}):\n${problems.map(problem => `  ${problem}`).join('\n')}`);
  process.exit(1);
}
console.log(`Documentation check passed (${docs.length} documents).`);
