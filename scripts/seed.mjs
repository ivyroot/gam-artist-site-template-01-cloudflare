import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const c = JSON.parse(readFileSync(new URL('../site.config.json', import.meta.url), 'utf8'));
if (c.artist || c.contract)
  throw new Error('Sample data is only allowed in an unconfigured local template.');
const hex = (s) => Buffer.from(s).toString('hex');
const q = (s) => "'" + s.replaceAll("'", "''") + "'";
const works = [
  [
    '0',
    'Quiet geometry',
    'Digital composition',
    'A study in balance, warmth, and the space between.',
    '/samples/quiet-geometry.svg',
    '1500000',
  ],
  [
    '1',
    'The long way home',
    'Digital composition',
    'Soft horizons for an unhurried afternoon.',
    '/samples/long-way-home.svg',
    '2000000',
  ],
  [
    '2',
    'Almost a garden',
    'Digital composition',
    'A small celebration of organic forms.',
    '/samples/almost-a-garden.svg',
    '1500000',
  ],
];
let sql =
  'DELETE FROM events; DELETE FROM drafts; UPDATE sync SET cursor=0,level=0,block_hash=NULL,updated=NULL WHERE id=1;';
if (!process.argv.includes('--clear')) {
  for (const [id, title, type, description, preview, price] of works) {
    const payload = {
      artist: 'SAMPLE',
      artist_name: hex('Example artist'),
      listing_id: id,
      title: hex(title),
      item_type: hex(type),
      description: hex(description),
      personal_price: price,
      commercial_price: '10000000',
      website_id: 0,
      website_url: c.origin,
      active: true,
      file_hash: '00'.repeat(32),
    };
    sql += `INSERT INTO events VALUES(${Number(id) + 1},0,'listed',${q(JSON.stringify(payload))});INSERT INTO drafts VALUES('listing',${q(id)},${q(JSON.stringify({ preview }))});`;
  }
  const p = {
    artist: 'SAMPLE',
    collection_id: '0',
    title: hex('Studies in being here'),
    description: hex('Three studies in shape and quiet attention.'),
    personal_price: '4000000',
    commercial_price: '25000000',
    website_id: 0,
    active: true,
  };
  sql += `INSERT INTO events VALUES(4,0,'collection_set',${q(JSON.stringify(p))});`;
  for (let i = 0; i < 3; i++)
    sql += `INSERT INTO events VALUES(${i + 5},0,'collection_item_set',${q(JSON.stringify({ artist: 'SAMPLE', collection_id: '0', listing_id: String(i), included: true }))});`;
}
const result = spawnSync(
  process.execPath,
  [
    'node_modules/cf/bin/cf',
    'd1',
    'raw',
    `DB-${JSON.parse(readFileSync(new URL('../site.config.json', import.meta.url), 'utf8')).workerName}`,
    '--local',
    '--sql',
    sql,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
