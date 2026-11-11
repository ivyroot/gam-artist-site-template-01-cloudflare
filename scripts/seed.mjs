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
    'Quiet Geometry',
    'Digital composition',
    'Example Artwork 1 pairs warm paper tones with an ornate embossed border and simple ink lettering. Its restrained composition leaves room to breathe, bringing a quiet sense of balance to the space around it.',
    '/samples/quiet-geometry.webp',
    '1500000',
  ],
  [
    '1',
    'The long way home',
    'Digital composition',
    'Example Artwork 2 combines soft sage paper, charcoal lettering, and the delicate relief of an embossed frame. The muted green palette offers a gentle change of pace, inviting a longer look at its texture and detail.',
    '/samples/long-way-home.webp',
    '2000000',
  ],
  [
    '2',
    'Almost a garden',
    'Digital composition',
    'Example Artwork 3 sets understated ink lettering against warm terracotta paper and a decorative embossed border. Earthy color and fine details give this sample a welcoming presence, adding a little warmth to an everyday corner.',
    '/samples/almost-a-garden.webp',
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
    title: hex('Collected Examples: Shape and Quiet Attention'),
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
