CREATE TABLE IF NOT EXISTS promo_files ( id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, alt TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS work_promo_files ( position INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('listing','collection')), work_id TEXT NOT NULL, promo_id TEXT NOT NULL REFERENCES promo_files(id) ON DELETE RESTRICT, UNIQUE(kind,work_id,promo_id) );
CREATE INDEX IF NOT EXISTS work_promo_order ON work_promo_files(kind,work_id,position);
INSERT OR IGNORE INTO promo_files(id,object_key,name,content_type,size,created) SELECT substr(json_extract(data,'$.preview'),11), substr(json_extract(data,'$.preview'),11), 'Existing preview', 'application/octet-stream', 0, 0 FROM drafts WHERE json_extract(data,'$.preview') GLOB '/previews/*';
INSERT OR IGNORE INTO work_promo_files(kind,work_id,promo_id) SELECT kind,id,substr(json_extract(data,'$.preview'),11) FROM drafts WHERE json_extract(data,'$.preview') GLOB '/previews/*';
UPDATE drafts SET data=json_remove(data,'$.preview') WHERE json_extract(data,'$.preview') GLOB '/previews/*';
