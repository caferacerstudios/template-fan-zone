import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {applyGeneratedCorrections, validateGeneratedCollection, mergePublishedArticles, normalizeGeneratedCitations} from '../src/lib/news-artifacts.mjs';
import {importNewsSnapshot} from '../scripts/import-news-snapshot.mjs';

const source1 = 'https://www.{team}.com/news/example-one';
const source2 = 'https://www.nfl.com/news/example-two';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function article(day) {
  return {slug:`daily-{team}-2026-09-${day}-test-story`, headline:'A fixture article for {Team} tests', dek:'A fixture description that is never published on the live website.',
    publishedAt:`2026-09-${day}T15:00:00Z`, updatedAt:`2026-09-${day}T15:00:00Z`, author:'{Team} Fan Zone', category:'Analysis', tags:['Testing'], season:null, opponent:null,
    body:[{type:'heading',heading:'Fixture'},{type:'paragraph',html:`Escaped plain text with citations <a href="${source1}">[1]</a> <a href="${source2}">[2]</a>`}],
    sources:[{label:'Fixture source one',url:source1},{label:'Fixture source two',url:source2}],
    hero:{src:'/images/news/newsroom-field.svg',alt:'Abstract field',width:1200,height:675,caption:'Illustration.'},
    featured:false,status:'published',generation:{kind:'ai',publicationDay:`2026-09-${day}`,model:'fixture'}};
}
function fixture(t, articles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfz-news-test-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const project = path.join(root,'project'), snapshot = path.join(root,'snapshot');
  fs.mkdirSync(path.join(project,'src/data/news'),{recursive:true});
  fs.mkdirSync(snapshot);
  fs.writeFileSync(path.join(project,'src/data/news/generated-articles.json'), JSON.stringify({schema_version:1,articles:[]}));
  const bytes = Buffer.from(JSON.stringify({schema_version:1,articles}));
  fs.writeFileSync(path.join(snapshot,'articles.json'),bytes);
  const manifest = {schema_version:1,runId:'test',sourceCommit:'a'.repeat(40),updatedAt:'2026-09-11T16:00:00Z',articleCount:articles.length,files:{'articles.json':hash(bytes)}};
  fs.writeFileSync(path.join(snapshot,'manifest.json'),JSON.stringify(manifest));
  return {projectRoot:project,snapshotDir:snapshot,now:Date.parse('2026-09-11T17:00:00Z'),manifest};
}

test('newest lead and next six retain the full older collection; featured/edits do not pin', () => {
  const all = Array.from({length:9},(_,i)=>article(String(i+1).padStart(2,'0')));
  all[0].featured = true; all[0].updatedAt = '2026-09-11T15:00:00Z';
  const sorted = mergePublishedArticles([],all,Date.parse('2026-09-11'));
  assert.equal(sorted.length,9); assert.equal(sorted[0].slug,all[8].slug);
  assert.deepEqual(sorted.slice(1,7).map(a=>a.slug),all.slice(2,8).reverse().map(a=>a.slug));
  assert.deepEqual(sorted.slice(7).map(a=>a.slug),all.slice(0,2).reverse().map(a=>a.slug));
  const manual = {...article('10'),slug:'an-authored-story'};
  assert.equal(mergePublishedArticles([manual],all,Date.parse('2026-09-11'))[0].slug,manual.slug);
  assert.equal(mergePublishedArticles([],all,Date.parse('2026-09-05T00:00:00Z')).length,4);
  assert.throws(()=>mergePublishedArticles([all[0]],all),/collision/);
});
test('generated HTML rejects scripts, unsafe links and malformed citations', () => {
  validateGeneratedCollection({schema_version:1,articles:[article('01')]});
  for (const html of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','<a href="javascript:alert(1)">click</a>','<a href="https://evil.example/">link</a>']) {
    const a = article('01'); a.body[1].html=html;
    assert.throws(()=>validateGeneratedCollection({schema_version:1,articles:[a]}));
  }
  assert.throws(()=>validateGeneratedCollection({schema_version:1,articles:[article('01'),article('01')]}));
});
test('producer source markers normalize exactly once and unknown or mismatched IDs fail', () => {
  const marked = article('01');
  marked.body[1].html = `[S1][S2] <a href="${source1}">[1]</a> <a href="${source2}">[2]</a>`;
  const once = normalizeGeneratedCitations({schema_version:1,articles:[marked]});
  assert.doesNotMatch(once.articles[0].body[1].html, /\[S\d+\]/);
  assert.deepEqual(normalizeGeneratedCitations(once), once);
  validateGeneratedCollection(once);
  const unknown = article('01'); unknown.body[1].html = `[S3] <a href="${source1}">[1]</a>`;
  assert.throws(() => normalizeGeneratedCitations({schema_version:1,articles:[unknown]}), /Unknown source identifier S3/);
  const mismatched = article('01'); mismatched.body[1].html = `[S2] <a href="${source1}">[1]</a>`;
  assert.throws(() => normalizeGeneratedCitations({schema_version:1,articles:[mismatched]}), /does not resolve/);
});
test('corrections preserve publication identity and remain stable across repeated application', () => {
  const original = article('01');
  const corrections = {articles:{[original.slug]:{updatedAt:'2026-09-11T17:00:00Z',sourceUrls:[source1,source2],body:[{type:'paragraph',html:`Corrected copy <a href="${source1}">[1]</a>`}]}}};
  const once = applyGeneratedCorrections({schema_version:1,articles:[original]}, corrections);
  const twice = applyGeneratedCorrections(once, corrections);
  assert.equal(once.articles[0].slug, original.slug);
  assert.equal(once.articles[0].publishedAt, original.publishedAt);
  assert.equal(once.articles[0].generation.publicationDay, original.generation.publicationDay);
  assert.deepEqual(twice, once);
  validateGeneratedCollection(once);
});
test('import repeats are stable and a stale partial snapshot cannot erase history', t => {
  const f = fixture(t,[article('01'),article('02')]);
  importNewsSnapshot(f);
  const target = path.join(f.projectRoot,'src/data/news/generated-articles.json');
  const before = fs.readFileSync(target);
  importNewsSnapshot(f); assert.deepEqual(fs.readFileSync(target),before);
  const bytes = Buffer.from(JSON.stringify({schema_version:1,articles:[article('02')]}));
  fs.writeFileSync(path.join(f.snapshotDir,'articles.json'),bytes);
  f.manifest.articleCount=1; f.manifest.files['articles.json']=hash(bytes);
  fs.writeFileSync(path.join(f.snapshotDir,'manifest.json'),JSON.stringify(f.manifest));
  assert.throws(()=>importNewsSnapshot(f),/remove stored history/);
  assert.deepEqual(fs.readFileSync(target),before);
});
test('checksums and check-only protect the existing input', t => {
  const f=fixture(t,[article('01')]);
  const target=path.join(f.projectRoot,'src/data/news/generated-articles.json');
  const before=fs.readFileSync(target);
  importNewsSnapshot({...f,checkOnly:true}); assert.deepEqual(fs.readFileSync(target),before);
  fs.appendFileSync(path.join(f.snapshotDir,'articles.json'),' ');
  assert.throws(()=>importNewsSnapshot(f),/checksum/);
  assert.deepEqual(fs.readFileSync(target),before);
});
test('missing snapshots retain validated input while broken snapshots fail', t => {
  const f=fixture(t,[]);
  importNewsSnapshot({...f,snapshotDir:path.join(f.projectRoot,'absent'),ifAvailable:true});
  fs.symlinkSync('/a-missing-sfz-test-path',path.join(f.projectRoot,'broken'));
  assert.throws(()=>importNewsSnapshot({...f,snapshotDir:path.join(f.projectRoot,'broken'),ifAvailable:true}));
});
test('fresh builds restore every referenced historical image', t => {
  const a=article('01'); const photo=Buffer.from('fixture image bytes'); const filename=hash(photo)+'.png';
  a.hero.src='/images/news/generated/'+filename;
  const f=fixture(t,[a]);
  fs.mkdirSync(path.join(f.snapshotDir,'images'));
  fs.writeFileSync(path.join(f.snapshotDir,'images',filename),photo);
  f.manifest.files['images/'+filename]=hash(photo);
  fs.writeFileSync(path.join(f.snapshotDir,'manifest.json'),JSON.stringify(f.manifest));
  importNewsSnapshot(f);
  const dest=path.join(f.projectRoot,'public/images/news/generated',filename);
  assert.deepEqual(fs.readFileSync(dest),photo);
  fs.rmSync(dest); importNewsSnapshot(f); assert.deepEqual(fs.readFileSync(dest),photo);
});
