#!/usr/bin/env node
// Read a complete immutable release; install images before swapping the article file.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {applyGeneratedCorrections, GENERATED_IMAGE, normalizeGeneratedCitations, validateGeneratedCollection} from '../src/lib/news-artifacts.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function writeAtomic(filename, bytes) {
  fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o755});
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o644);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, filename);
  } finally { fs.rmSync(temporary, {force: true}); }
}

export function importNewsSnapshot({projectRoot = root, snapshotDir = process.env.NEWS_SNAPSHOT_DIR || '/var/lib/sfz-news/current', checkOnly = false, ifAvailable = false, now = Date.now()} = {}) {
  const target = path.join(projectRoot, 'src/data/news/generated-articles.json');
  const correctionsFile = path.join(projectRoot, 'src/data/news/generated-corrections.json');
  const corrections = fs.existsSync(correctionsFile) ? read(correctionsFile) : {articles:{}};
  const stored = read(target);
  const existing = validateGeneratedCollection(applyGeneratedCorrections(normalizeGeneratedCitations(stored), corrections));
  let present = true;
  try { fs.lstatSync(snapshotDir); } catch (error) { if (error.code === 'ENOENT') present = false; else throw error; }
  if (!present && ifAvailable) {
    for (const article of existing.articles) {
      const match = GENERATED_IMAGE.exec(article.hero.src);
      if (match) {
        const file = path.join(projectRoot, 'public/images/news/generated', match[1]);
        if (!fs.existsSync(file) || hash(fs.readFileSync(file)) !== match[1].split('.')[0]) throw new Error('Existing news data is missing its retained image');
      }
    }
    if (!checkOnly && JSON.stringify(existing) !== JSON.stringify(stored)) writeAtomic(target, Buffer.from(`${JSON.stringify(existing, null, 2)}\n`));
    console.warn(`News snapshot unavailable at ${snapshotDir}; retained existing news.`);
    return {status: 'unavailable', articleCount: existing.articles.length};
  }
  const selected = fs.realpathSync(snapshotDir);
  const manifest = read(path.join(selected, 'manifest.json'));
  if (!object(manifest) || manifest.schema_version !== 1 || !object(manifest.files) || !Object.hasOwn(manifest.files, 'articles.json') || typeof manifest.runId !== 'string' || !manifest.runId || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? '') || !Number.isFinite(Date.parse(manifest.updatedAt)) || Date.parse(manifest.updatedAt) > now + 300000) throw new Error('Invalid news manifest');
  const files = new Map();
  for (const [name, checksum] of Object.entries(manifest.files)) {
    if (name !== 'articles.json' && !/^images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(name)) throw new Error('Invalid snapshot file path');
    const filename = path.join(selected, name);
    if (!fs.lstatSync(filename).isFile()) throw new Error('Snapshot entries must be regular files');
    const bytes = fs.readFileSync(filename);
    if (!/^[a-f0-9]{64}$/.test(checksum) || hash(bytes) !== checksum) throw new Error(`News checksum mismatch: ${name}`);
    files.set(name, bytes);
  }
  const normalized = normalizeGeneratedCitations(JSON.parse(files.get('articles.json').toString('utf8')));
  const corrected = applyGeneratedCorrections(normalized, corrections);
  const document = validateGeneratedCollection(corrected);
  if (document.articles.length !== manifest.articleCount) throw new Error('News manifest count mismatch');
  const incomingSlugs = new Set(document.articles.map(a => a.slug));
  if (existing.articles.some(a => !incomingSlugs.has(a.slug))) throw new Error('News snapshot would remove stored history; import stopped');
  const requiredImages = new Set();
  for (const article of document.articles) {
    if (Date.parse(article.publishedAt) > now + 300000) throw new Error('Generated article has a future publication timestamp');
    const match = GENERATED_IMAGE.exec(article.hero.src);
    if (match) {
      const name = 'images/' + match[1];
      if (!files.has(name) || hash(files.get(name)) !== match[1].split('.')[0]) throw new Error('Article has a missing or misidentified image');
      requiredImages.add(name);
    }
  }
  if (files.size !== requiredImages.size + 1) throw new Error('News snapshot contains unreferenced files');
  if (now - Date.parse(manifest.updatedAt) > 48 * 3600000) console.warn(`News snapshot is over 48 hours old: ${manifest.updatedAt}`);
  if (!checkOnly) {
    for (const name of requiredImages) {
      const dest = path.join(projectRoot, 'public/images/news/generated', path.basename(name));
      if (!fs.existsSync(dest) || hash(fs.readFileSync(dest)) !== hash(files.get(name))) writeAtomic(dest, files.get(name));
    }
    const acceptedBytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
    if (!fs.readFileSync(target).equals(acceptedBytes)) writeAtomic(target, acceptedBytes);
  }
  return {status: 'success', articleCount: document.articles.length, snapshotDir: selected, updatedAt: manifest.updatedAt, checkOnly};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--check-only', '--if-available'].includes(arg))) throw new Error('Usage: node scripts/import-news-snapshot.mjs [--check-only] [--if-available]');
    console.log(JSON.stringify(importNewsSnapshot({checkOnly: args.includes('--check-only'), ifAvailable: args.includes('--if-available')})));
  } catch (error) { console.error(`News import failed: ${error.message}`); process.exitCode = 1; }
}
