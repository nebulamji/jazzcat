// jazzcat/recipes: New Jazz City's Oak recipes (oak-recipe/v1), the files in this package's recipes/ folder. Data only:
// each one names a contract on Robinhood Chain, a function and its inputs, for Oak to fill and for your own wallet to sign.
// Node only (it reads the files).
import {readFileSync, readdirSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const OAK_PROJECT = 'new-jazz-city';
const DIR = new URL('../recipes/', import.meta.url);
const FILE = /^[a-z0-9-]{1,40}\.recipe\.json$/;

/** Every recipe, sorted by name. */
export function recipes() {
  return readdirSync(DIR).filter(f => FILE.test(f)).sort().map(f => JSON.parse(readFileSync(new URL(f, DIR), 'utf8')));
}
/** One recipe by name, or null. */
export function recipe(name) { return recipes().find(r => r.name === name) ?? null; }
/** Write every recipe into dir as <name>.recipe.json, for: oak recipes add <dir>. Returns the paths written. */
export function writeRecipes(dir) {
  mkdirSync(dir, {recursive: true});
  return recipes().map(r => { const p = join(dir, `${r.name}.recipe.json`); writeFileSync(p, JSON.stringify(r, null, 2) + '\n'); return p; });
}
