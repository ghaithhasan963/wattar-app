#!/usr/bin/env node
/**
 * Wattar — committed-secret guard (M2.7)
 *
 * Fails the build if a real secret is tracked by git. Public keys
 * (sb_publishable_ / anon) are expected in app and admin env files and are
 * not flagged. Placeholders such as YOUR_KEY are ignored.
 *
 * Usage: node scripts/check-secrets.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKIP_FILES = new Set([
  'scripts/check-secrets.mjs',
  'wattar-app/package-lock.json',
  'wattar-admin/package-lock.json',
  'wattar-functions/deno.lock',
]);
const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|sql|ps1|sh|md|toml|env|example)$/i;

const RULES = [
  {
    name: 'JWT / Supabase legacy key',
    // Three base64url segments; ignores short examples and placeholders.
    regex: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    name: 'Supabase secret key',
    regex: /sb_secret_[A-Za-z0-9_-]{16,}/g,
  },
  {
    name: 'Private key block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: 'Hardcoded secret assignment',
    regex: /(?:service_role_key|livekit_api_secret|api_secret|client_secret)\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{16,}["']/gi,
  },
];

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function isTrackedLocalEnv(file) {
  const name = file.split('/').pop() ?? '';
  return (name === '.env' || name.startsWith('.env.')) && name !== '.env.example';
}

const problems = [];

for (const file of trackedFiles()) {
  if (isTrackedLocalEnv(file)) {
    problems.push(`${file}: local environment file is tracked by git`);
    continue;
  }
  if (SKIP_FILES.has(file) || !TEXT_EXTENSIONS.test(file)) continue;

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    const match = rule.regex.exec(text);
    if (!match) continue;
    if (/YOUR_|PLACEHOLDER|EXAMPLE|xxxx/i.test(match[0])) continue;
    const line = text.slice(0, match.index).split('\n').length;
    problems.push(`${file}:${line}: possible ${rule.name}`);
  }
}

if (problems.length > 0) {
  console.error('Committed secret check failed:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}

console.log('Committed secret check passed.');
