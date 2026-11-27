// The Oak recipes, held to the rules Oak applies when it adds a package (@oakagentkit/addon 0.4.3): package.json carries
// oakProject; recipes live at recipes/<slug>.recipe.json, each at most 64 KiB, named for its file, in that project; plus
// the package rules from New Jazz City's own validator (EIP-55 contracts, inputs that match the function, exact approvals).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recipes, recipe, writeRecipes, OAK_PROJECT} from 'jazzcat/recipes';
import {checksum} from '../lib/keccak.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const DIR = new URL('../recipes/', import.meta.url);

test('package.json names the Oak project the recipes belong to', () => {
  assert.equal(pkg.oakProject, OAK_PROJECT); assert.match(pkg.oakProject, /^[a-z0-9-]{1,40}$/);
  assert.ok(pkg.files.includes('recipes'));
});

test('every recipe file follows Oak\'s rules', () => {
  const files = readdirSync(DIR);
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.match(`package/recipes/${f}`, /^package\/recipes\/[a-z0-9-]{1,40}\.recipe\.json$/, f);
    assert.ok(statSync(new URL(f, DIR)).size <= 64 * 1024, `${f} is over 64 KiB`);
    const r = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
    assert.equal(`${r.name}.recipe.json`, f); assert.equal(r.project, pkg.oakProject, f);
    assert.equal(r.schema, 'oak-recipe/v1'); assert.equal(r.chainId, 4663);
    assert.equal(checksum(r.contract), r.contract, `${f}: contract is EIP-55`);
    assert.ok(['read', 'tx'].includes(r.kind), f);
    assert.equal(r.inputs.length, r.function.inputs.length, `${f}: inputs`);
    r.inputs.forEach((x, i) => assert.equal(x.type, r.function.inputs[i].type, `${f}: input ${x.name}`));
    if (r.kind === 'read') assert.ok(['view', 'pure'].includes(r.function.stateMutability), `${f}: a read is view`);
    else assert.ok(!['view', 'pure'].includes(r.function.stateMutability), `${f}: a tx is not view`);
    if (r.approve) assert.ok(r.inputs.some(x => x.name === r.approve.amountFromInput && /^uint/.test(x.type)), `${f}: an approval is exactly a uint input`);
  }
});

test('the one approval in the package is exact', () => {
  const approving = recipes().filter(r => r.approve);
  assert.deepEqual(approving.map(r => r.name), ['fee-flow-buy']);
  assert.equal(approving[0].approve.amountFromInput, 'maxPayment');
});

test('recipe() and writeRecipes() give back the same files', () => {
  assert.equal(recipe('cat-payee-of').function.name, 'payeeOf'); assert.equal(recipe('nope'), null);
  const dir = mkdtempSync(join(tmpdir(), 'jazzcat-recipes-')), written = writeRecipes(dir);
  assert.equal(written.length, recipes().length);
  for (const p of written) { const name = p.split('/').pop(); assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), JSON.parse(readFileSync(new URL(name, DIR), 'utf8'))); }
});
