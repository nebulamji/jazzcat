// What npm would publish: only the package's own files, under Oak's 100-entry limit, with no secrets and no machine paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}));
const ALLOWED = /^(bin\/jazzcat\.mjs|lib\/[a-z]+\.(js|d\.ts)|recipes\/[a-z0-9-]{1,40}\.recipe\.json|examples\/[a-z-]+\.mjs|README\.md|LICENSE|package\.json)$/;
const NEVER = [/\/srv\//, /\/home\//, /\/Users\//, /\/run\/njc/, /njc-private/, /jazzcats-private/, /private_key/i, /seed phrase:/i, /mnemonic/i,
  /sk-orb/, /ghp_[A-Za-z0-9]/, /github_pat_/, /x-access-token/, /BEGIN [A-Z ]*PRIVATE KEY/, /npm_[A-Za-z0-9]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /cf-wrangler/, /(^|[\s'"`/])\.env(\.[a-z]+)?\b/m];

test('the tarball holds only the package\'s own files', () => {
  assert.equal(packed.name, 'jazzcat');
  for (const f of packed.files) assert.match(f.path, ALLOWED, `unexpected file in the tarball: ${f.path}`);
  for (const must of ['bin/jazzcat.mjs', 'lib/sdk.js', 'lib/proof.js', 'lib/recipes.js', 'lib/keccak.js', 'README.md', 'LICENSE', 'package.json'])
    assert.ok(packed.files.some(f => f.path === must), `missing ${must}`);
  assert.ok(packed.entryCount <= 100, 'Oak reads at most 100 entries from a package');
});

test('no secrets and no paths from our machines in any packed file', () => {
  for (const f of packed.files) {
    const text = readFileSync(new URL(f.path, new URL('..', import.meta.url)), 'utf8');
    for (const re of NEVER) assert.doesNotMatch(text, re, `${f.path} matches ${re}`);
  }
});

test('no runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies, undefined); assert.equal(pkg.optionalDependencies, undefined); assert.equal(pkg.peerDependencies, undefined);
});
