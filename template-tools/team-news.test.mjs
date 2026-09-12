import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { importNewsSnapshot } from '../scripts/import-news-snapshot.mjs';
import { validateGeneratedCollection, mergePublishedArticles } from '../src/lib/news-artifacts.mjs';
import { loadNewsSite, retainNews, restoreNews } from './news.mjs';
import { renderProject, teamSettings } from './render.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const now = Date.parse('2026-09-11T17:00:00Z');
const site = team => loadNewsSite(root, team);
function article(team, day = '10') {
  const source = `https://www.${site(team).source_domains[0]}/news/fixture`;
  return { team, slug:`daily-${team}-2026-09-${day}-fixture-story`, headline:`${team} fixture story`, dek:'Fixture only.',
    author:'Fixture newsroom', category:team === 'broncos' ? 'AFC West' : 'NFC West', tags:['Analysis'], season:2026, opponent:null,
    publishedAt:`2026-09-${day}T15:00:00Z`, updatedAt:`2026-09-${day}T15:00:00Z`, status:'published', featured:false,
    sources:[{label:'Team',url:source},{label:'NFL',url:'https://www.nfl.com/news/fixture'}],
    body:[{type:'paragraph',html:`Literal {Team} marker must survive importing. <a href="${source}">[1]</a> <a href="https://www.nfl.com/news/fixture">[2]</a>`}],
    hero:{src:'/images/news/newsroom-field.svg',alt:'Football illustration',caption:'Illustration.',width:1200,height:675},
    generation:{kind:'ai',publicationDay:`2026-09-${day}`,model:'fixture'} };
}
function fixture(t, team) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'team-news-'));
  t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
  const projectRoot = path.join(temp, 'site'), snapshotDir = path.join(temp, 'release');
  fs.mkdirSync(path.join(projectRoot, 'src/data/news'), {recursive:true});
  fs.mkdirSync(snapshotDir);
  fs.writeFileSync(path.join(projectRoot, 'src/data/news/generated-articles.json'), JSON.stringify({schema_version:1,team,articles:[]}));
  return { projectRoot, snapshotDir, site:site(team), now, temp };
}
function publish(f, articles, team = f.site.team, photo) {
  const bytes = Buffer.from(JSON.stringify({schema_version:1,team,articles}));
  fs.writeFileSync(path.join(f.snapshotDir,'articles.json'),bytes);
  const files = {'articles.json':hash(bytes)};
  if (photo) {
    const name = `images/${hash(photo)}.png`;
    fs.mkdirSync(path.join(f.snapshotDir,'images'),{recursive:true});
    fs.writeFileSync(path.join(f.snapshotDir,name),photo);
    files[name] = hash(photo);
  }
  fs.writeFileSync(path.join(f.snapshotDir,'manifest.json'),JSON.stringify({schema_version:1,team,runId:'fixture',sourceCommit:'a'.repeat(40),updatedAt:'2026-09-11T16:00:00Z',articleCount:articles.length,files}));
}

test('configuration preserves the requested roots and isolates future teams', t => {
  assert.equal(site('seahawks').news_snapshot_dir, '/var/lib/sfz-news/current');
  assert.equal(site('broncos').news_snapshot_dir, '/var/lib/boncosfz-news/current');
  assert.deepEqual(site('broncos').source_domains, ['denverbroncos.com','nfl.com']);
  const f=fixture(t,'broncos');
  const config=JSON.parse(fs.readFileSync(path.join(root,'config/active-sites.json')));
  const filename=path.join(f.temp,'sites.json');
  fs.writeFileSync(filename,JSON.stringify({fan_zone_active_sites:JSON.stringify(config)}));
  assert.equal(loadNewsSite(root,'broncos',filename).team,'broncos');
  config.broncos.news_photos_dir=config.seahawks.news_photos_dir;
  fs.writeFileSync(filename,JSON.stringify(config));
  assert.throws(()=>loadNewsSite(root,'broncos',filename),/same team news directory|must not share/);
  assert.throws(()=>loadNewsSite(root,'patriots'),/Add patriots/);
});

test('a Broncos snapshot keeps original text, uses official domains, and adds the clear tag', t => {
  const f=fixture(t,'broncos'); publish(f,[article('broncos')]);
  importNewsSnapshot(f);
  const result=JSON.parse(fs.readFileSync(path.join(f.projectRoot,'src/data/news/generated-articles.json')));
  assert.equal(result.team,'broncos');
  assert.equal(result.articles[0].team,'broncos');
  assert.ok(result.articles[0].tags.includes('broncos'));
  assert.match(result.articles[0].body[0].html,/Literal \{Team\} marker/);
  const bad=article('broncos'); bad.sources[0].url='https://denverbroncos.com.evil.example/news/test';
  assert.throws(()=>validateGeneratedCollection({schema_version:1,team:'broncos',articles:[bad]},{site:f.site}));
});

test('wrong-team manifests and mixed or untagged new-team articles cannot replace accepted news', t => {
  const f=fixture(t,'broncos'); publish(f,[article('broncos')]); importNewsSnapshot(f);
  const filename=path.join(f.projectRoot,'src/data/news/generated-articles.json');
  const before=fs.readFileSync(filename);
  publish(f,[article('seahawks')],'seahawks');
  assert.throws(()=>importNewsSnapshot(f),/expected broncos/);
  publish(f,[article('broncos'),article('seahawks','11')]);
  assert.throws(()=>importNewsSnapshot(f),/expected broncos/);
  const missing=article('broncos'); delete missing.team;
  publish(f,[missing]);
  assert.throws(()=>importNewsSnapshot(f),/untagged team/);
  assert.deepEqual(fs.readFileSync(filename),before);
});

test('the existing untagged Seahawks release imports without changing its slug', t => {
  const f=fixture(t,'seahawks'), a=article('seahawks'); delete a.team;
  publish(f,[a],undefined);
  for (const filename of ['manifest.json','articles.json']) {
    const p=path.join(f.snapshotDir,filename), data=JSON.parse(fs.readFileSync(p)); delete data.team;
    fs.writeFileSync(p,JSON.stringify(data));
  }
  const manifestFile=path.join(f.snapshotDir,'manifest.json'), manifest=JSON.parse(fs.readFileSync(manifestFile));
  manifest.files['articles.json']=hash(fs.readFileSync(path.join(f.snapshotDir,'articles.json')));
  fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  importNewsSnapshot(f);
  const document=JSON.parse(fs.readFileSync(path.join(f.projectRoot,'src/data/news/generated-articles.json')));
  assert.equal(document.articles[0].team,'seahawks');
  assert.equal(document.articles[0].slug,a.slug);
});

test('an untagged prior Seattle build survives migration while old Broncos demos are discarded', t => {
  const f=fixture(t,'seahawks'), a=article('seahawks'); delete a.team;
  const filename=path.join(f.projectRoot,'src/data/news/generated-articles.json');
  fs.writeFileSync(filename,JSON.stringify({schema_version:1,articles:[a]}));
  const retained=retainNews(f.projectRoot,f.site);
  assert.equal(retained.document.team,'seahawks');
  assert.equal(retained.document.articles[0].slug,a.slug);
  assert.equal(retainNews(f.projectRoot,site('broncos')),null);
});

test('retained team news survives rebuilding and missing snapshots without reshuffling images', t => {
  const f=fixture(t,'broncos'), a=article('broncos');
  const photo=Buffer.from('selected-photo-fixture');
  a.hero.src=`/images/news/generated/${hash(photo)}.png`;
  publish(f,[a],f.site.team,photo); importNewsSnapshot(f);
  const retained=retainNews(f.projectRoot,f.site);
  fs.rmSync(f.projectRoot,{recursive:true});
  fs.mkdirSync(path.join(f.projectRoot,'src/data/news'),{recursive:true});
  restoreNews(f.projectRoot,retained);
  assert.equal(importNewsSnapshot({...f,snapshotDir:path.join(f.temp,'absent'),ifAvailable:true}).articleCount,1);
  assert.deepEqual(fs.readFileSync(path.join(f.projectRoot,'public',a.hero.src.slice(1))),photo);
  publish(f,[]);
  assert.throws(()=>importNewsSnapshot(f),/remove stored history/);
});

test('both teams can publish on the same day without appearing in each other\'s collection', () => {
  const a=article('seahawks'), b=article('broncos');
  assert.deepEqual(mergePublishedArticles([a],[b],now,'broncos').map(a=>a.team),['broncos']);
  assert.deepEqual(mergePublishedArticles([a],[b],now,'seahawks').map(a=>a.team),['seahawks']);
});

test('rendering keeps Seattle editorial sources intact and selects only matching generated seeds', async t => {
  const f=fixture(t,'broncos');
  await renderProject(root,f.projectRoot,teamSettings('broncos'),{linkDependencies:false,newsSite:f.site});
  const authored=fs.readFileSync(path.join(f.projectRoot,'src/lib/news.ts'),'utf8');
  assert.match(authored,/What made the 2025 Seahawks champions/);
  assert.doesNotMatch(authored,/What made the 2025 Broncos champions/);
  const generated=JSON.parse(fs.readFileSync(path.join(f.projectRoot,'src/data/news/generated-articles.json')));
  assert.equal(generated.team,'broncos'); assert.deepEqual(generated.articles,[]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.projectRoot,'src/data/news-site.json'))).news_snapshot_dir,f.site.news_snapshot_dir);
});
