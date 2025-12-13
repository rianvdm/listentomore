PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE,
  lastfm_username TEXT,
  discogs_username TEXT,
  spotify_connected INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
, username TEXT);
INSERT INTO "users" VALUES('default',NULL,'bordesak','elezea-records',0,'2025-11-30 01:08:36','2025-12-11 00:20:18','rian');
CREATE TABLE searches (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT DEFAULT 'default' REFERENCES users(id),
  search_type TEXT NOT NULL, 
  query TEXT NOT NULL,
  result_id TEXT, 
  result_name TEXT,
  result_artist TEXT,
  searched_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE recent_searches (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  spotify_id TEXT NOT NULL,
  album_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  image_url TEXT,
  searched_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE discogs_sync_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  user_id TEXT DEFAULT 'default' REFERENCES users(id),
  last_full_sync TEXT,
  last_enrichment_sync TEXT,
  current_page INTEGER DEFAULT 0,
  total_pages INTEGER DEFAULT 0,
  enrichment_cursor INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle', 
  error_message TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO "discogs_sync_state" VALUES('default','default',NULL,NULL,0,0,0,'idle',NULL,'2025-11-30 01:08:36');
CREATE TABLE discogs_releases (
  id INTEGER PRIMARY KEY, 
  user_id TEXT DEFAULT 'default' REFERENCES users(id),
  instance_id INTEGER,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  year INTEGER,
  original_year INTEGER, 
  format TEXT,
  label TEXT,
  genres TEXT, 
  styles TEXT, 
  master_genres TEXT, 
  master_styles TEXT, 
  image_url TEXT,
  discogs_url TEXT,
  date_added TEXT,
  rating INTEGER,
  master_id INTEGER,
  master_enriched INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE rate_limits (
  service TEXT PRIMARY KEY, 
  requests_remaining INTEGER,
  window_reset_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO "rate_limits" VALUES('discogs',60,NULL,'2025-11-30 01:08:36');
INSERT INTO "rate_limits" VALUES('spotify',100,NULL,'2025-11-30 01:08:36');
INSERT INTO "rate_limits" VALUES('openai',60,NULL,'2025-11-30 01:08:36');
INSERT INTO "rate_limits" VALUES('perplexity',30,NULL,'2025-11-30 01:08:36');
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,

  
  key_hash TEXT NOT NULL UNIQUE,  
  key_prefix TEXT NOT NULL,        
  name TEXT DEFAULT 'Default',     

  
  tier TEXT DEFAULT 'standard' CHECK (tier IN ('public', 'standard', 'premium')),
  scopes TEXT DEFAULT '["read"]',  

  
  rate_limit_rpm INTEGER,

  
  request_count INTEGER DEFAULT 0,
  last_used_at TEXT,

  
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,  
  revoked_at TEXT   
);
INSERT INTO "api_keys" VALUES('b8ace7e8fb27fa39494f50ada34dee57',NULL,'fe05ec0b6bf513b01b0c9dc2a9e2057c717ee68559a06748df5933720706c3d0','ltm_2cdd','Test Key','standard','["read"]',NULL,2,'2025-11-30 01:09:25','2025-11-30 01:09:13',NULL,NULL);
CREATE TABLE api_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,

  
  endpoint TEXT NOT NULL,
  method TEXT DEFAULT 'GET',
  status_code INTEGER,

  
  ip_address TEXT,
  user_agent TEXT,

  
  response_time_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO "api_usage_log" VALUES(1,NULL,'/api/auth/keys','POST',200,'::1','curl/8.7.1',7,'2025-11-30 01:09:13');
INSERT INTO "api_usage_log" VALUES(2,'b8ace7e8fb27fa39494f50ada34dee57','/api/songlink','GET',200,'::1','curl/8.7.1',1202,'2025-11-30 01:09:20');
INSERT INTO "api_usage_log" VALUES(3,'b8ace7e8fb27fa39494f50ada34dee57','/api/songlink','GET',200,'::1','curl/8.7.1',1697,'2025-11-30 01:09:27');
INSERT INTO "api_usage_log" VALUES(4,NULL,'/api/internal/user-listens','GET',401,'::1','curl/8.7.1',NULL,'2025-12-02 00:31:25');
INSERT INTO "api_usage_log" VALUES(5,NULL,'/api/internal/search','GET',401,'::1','curl/8.7.1',NULL,'2025-12-02 00:32:27');
INSERT INTO "api_usage_log" VALUES(6,NULL,'/api/internal/search','GET',401,'::1','curl/8.7.1',1,'2025-12-02 00:32:34');
INSERT INTO "api_usage_log" VALUES(7,NULL,'/api/internal/search','GET',200,'::1','curl/8.7.1',870,'2025-12-02 00:32:47');
INSERT INTO "api_usage_log" VALUES(8,NULL,'/api/internal/discogs-test','GET',401,'::1','curl/8.7.1',1,'2025-12-09 02:51:20');
INSERT INTO "api_usage_log" VALUES(9,NULL,'/api/internal/discogs-test','GET',200,'::1','curl/8.7.1',103,'2025-12-09 02:51:38');
INSERT INTO "api_usage_log" VALUES(10,NULL,'/api/internal/discogs-collection','GET',500,'::1','curl/8.7.1',7,'2025-12-09 02:51:47');
INSERT INTO "api_usage_log" VALUES(11,NULL,'/api/internal/discogs-sync','POST',200,'::1','curl/8.7.1',19071,'2025-12-09 02:54:09');
INSERT INTO "api_usage_log" VALUES(12,NULL,'/api/internal/discogs-stats','GET',200,'::1','curl/8.7.1',11,'2025-12-09 02:54:16');
INSERT INTO "api_usage_log" VALUES(13,NULL,'/api/auth/discogs/status','GET',200,'::1','curl/8.7.1',7,'2025-12-09 03:01:14');
INSERT INTO "api_usage_log" VALUES(14,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',143,'2025-12-09 03:02:09');
INSERT INTO "api_usage_log" VALUES(15,NULL,'/api/auth/discogs/status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',9,'2025-12-09 03:03:00');
INSERT INTO "api_usage_log" VALUES(16,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',126,'2025-12-09 03:05:48');
INSERT INTO "api_usage_log" VALUES(17,NULL,'/api/internal/discogs-stats','GET',200,'::1','curl/8.7.1',19,'2025-12-09 03:08:02');
INSERT INTO "api_usage_log" VALUES(18,NULL,'/api/internal/user-recent-track','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',8,'2025-12-09 03:08:08');
INSERT INTO "api_usage_log" VALUES(19,NULL,'/api/internal/user-top-albums','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',3,'2025-12-09 03:08:08');
INSERT INTO "api_usage_log" VALUES(20,NULL,'/api/internal/user-top-artists','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',2,'2025-12-09 03:08:08');
INSERT INTO "api_usage_log" VALUES(21,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',17,'2025-12-09 03:08:08');
INSERT INTO "api_usage_log" VALUES(22,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',109,'2025-12-09 03:08:35');
INSERT INTO "api_usage_log" VALUES(23,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',142,'2025-12-09 03:10:16');
INSERT INTO "api_usage_log" VALUES(24,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',55,'2025-12-09 03:10:17');
INSERT INTO "api_usage_log" VALUES(25,NULL,'/api/auth/discogs/connect','HEAD',302,'::1','curl/8.7.1',135,'2025-12-09 03:11:37');
INSERT INTO "api_usage_log" VALUES(26,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',830,'2025-12-09 03:11:48');
INSERT INTO "api_usage_log" VALUES(27,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',44,'2025-12-09 03:11:48');
INSERT INTO "api_usage_log" VALUES(28,NULL,'/api/auth/discogs/connect','HEAD',302,'::1','curl/8.7.1',85,'2025-12-09 03:11:50');
INSERT INTO "api_usage_log" VALUES(29,NULL,'/api/auth/discogs/connect','GET',302,'127.0.0.1','curl/8.7.1',109,'2025-12-09 03:12:01');
INSERT INTO "api_usage_log" VALUES(30,NULL,'/api/auth/discogs/callback','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',1,'2025-12-09 03:12:50');
INSERT INTO "api_usage_log" VALUES(31,NULL,'/api/internal/user-listens','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',1,'2025-12-09 03:12:50');
INSERT INTO "api_usage_log" VALUES(32,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',83,'2025-12-09 03:13:04');
INSERT INTO "api_usage_log" VALUES(33,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',52,'2025-12-09 03:13:05');
INSERT INTO "api_usage_log" VALUES(34,NULL,'/api/auth/discogs/callback','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',143,'2025-12-09 03:13:21');
INSERT INTO "api_usage_log" VALUES(35,NULL,'/api/internal/user-listens','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',NULL,'2025-12-09 03:13:21');
INSERT INTO "api_usage_log" VALUES(36,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',146,'2025-12-09 03:15:11');
INSERT INTO "api_usage_log" VALUES(37,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',52,'2025-12-09 03:15:11');
INSERT INTO "api_usage_log" VALUES(38,NULL,'/api/auth/discogs/callback','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',166,'2025-12-09 03:15:21');
INSERT INTO "api_usage_log" VALUES(39,NULL,'/api/internal/user-listens','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',1,'2025-12-09 03:15:21');
INSERT INTO "api_usage_log" VALUES(40,NULL,'/api/auth/discogs/status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',11,'2025-12-09 03:15:51');
INSERT INTO "api_usage_log" VALUES(41,NULL,'/api/internal/user-listens','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',1,'2025-12-10 23:58:49');
INSERT INTO "api_usage_log" VALUES(42,NULL,'/api/internal/user-recent-track','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',16,'2025-12-10 23:58:59');
INSERT INTO "api_usage_log" VALUES(43,NULL,'/api/internal/user-top-artists','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',4,'2025-12-10 23:58:59');
INSERT INTO "api_usage_log" VALUES(44,NULL,'/api/internal/user-top-albums','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',6,'2025-12-10 23:58:59');
INSERT INTO "api_usage_log" VALUES(45,NULL,'/api/internal/discogs-stats','GET',404,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',24,'2025-12-10 23:58:59');
INSERT INTO "api_usage_log" VALUES(46,NULL,'/api/internal/discogs-stats','GET',404,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',13,'2025-12-10 23:59:37');
INSERT INTO "api_usage_log" VALUES(47,NULL,'/api/internal/user-recent-track','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',6,'2025-12-10 23:59:37');
INSERT INTO "api_usage_log" VALUES(48,NULL,'/api/internal/user-top-albums','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',7,'2025-12-10 23:59:37');
INSERT INTO "api_usage_log" VALUES(49,NULL,'/api/internal/user-top-artists','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',7,'2025-12-10 23:59:37');
INSERT INTO "api_usage_log" VALUES(50,NULL,'/api/internal/discogs-stats','GET',404,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',1,'2025-12-10 23:59:40');
INSERT INTO "api_usage_log" VALUES(51,NULL,'/api/internal/discogs-sync','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',18465,'2025-12-11 00:00:16');
INSERT INTO "api_usage_log" VALUES(52,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',31,'2025-12-11 00:00:18');
INSERT INTO "api_usage_log" VALUES(53,NULL,'/api/internal/user-recent-track','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',6,'2025-12-11 00:00:21');
INSERT INTO "api_usage_log" VALUES(54,NULL,'/api/internal/user-top-artists','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',2,'2025-12-11 00:00:21');
INSERT INTO "api_usage_log" VALUES(55,NULL,'/api/internal/user-top-albums','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',3,'2025-12-11 00:00:21');
INSERT INTO "api_usage_log" VALUES(56,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',55,'2025-12-11 00:00:21');
INSERT INTO "api_usage_log" VALUES(57,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',9,'2025-12-11 00:00:26');
INSERT INTO "api_usage_log" VALUES(58,NULL,'/api/internal/discogs-enrichment-status','GET',401,'::1','curl/8.7.1',NULL,'2025-12-11 00:05:11');
INSERT INTO "api_usage_log" VALUES(59,NULL,'/api/internal/user-listens','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',2,'2025-12-11 00:06:57');
INSERT INTO "api_usage_log" VALUES(60,NULL,'/api/internal/user-recent-track','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',6,'2025-12-11 00:07:03');
INSERT INTO "api_usage_log" VALUES(61,NULL,'/api/internal/user-top-albums','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',3,'2025-12-11 00:07:03');
INSERT INTO "api_usage_log" VALUES(62,NULL,'/api/internal/user-top-artists','GET',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',2,'2025-12-11 00:07:03');
INSERT INTO "api_usage_log" VALUES(63,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',16,'2025-12-11 00:07:03');
INSERT INTO "api_usage_log" VALUES(64,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',16,'2025-12-11 00:07:06');
INSERT INTO "api_usage_log" VALUES(65,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',16,'2025-12-11 00:07:06');
INSERT INTO "api_usage_log" VALUES(66,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',61769,'2025-12-11 00:08:13');
INSERT INTO "api_usage_log" VALUES(67,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',8,'2025-12-11 00:08:19');
INSERT INTO "api_usage_log" VALUES(68,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',8,'2025-12-11 00:08:19');
INSERT INTO "api_usage_log" VALUES(69,NULL,'/api/auth/discogs/disconnect','POST',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',6,'2025-12-11 00:14:43');
INSERT INTO "api_usage_log" VALUES(70,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',20,'2025-12-11 00:14:46');
INSERT INTO "api_usage_log" VALUES(71,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',34,'2025-12-11 00:14:46');
INSERT INTO "api_usage_log" VALUES(72,NULL,'/api/auth/discogs/disconnect','POST',500,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',1,'2025-12-11 00:14:48');
INSERT INTO "api_usage_log" VALUES(73,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',79,'2025-12-11 00:19:17');
INSERT INTO "api_usage_log" VALUES(74,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',20,'2025-12-11 00:19:17');
INSERT INTO "api_usage_log" VALUES(75,NULL,'/api/auth/discogs/disconnect','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',3,'2025-12-11 00:19:20');
INSERT INTO "api_usage_log" VALUES(76,NULL,'/api/auth/discogs/connect','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',106,'2025-12-11 00:19:26');
INSERT INTO "api_usage_log" VALUES(77,NULL,'/api/auth/discogs/callback','GET',302,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',149,'2025-12-11 00:20:18');
INSERT INTO "api_usage_log" VALUES(78,NULL,'/api/internal/discogs-stats','GET',404,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',2,'2025-12-11 00:20:18');
INSERT INTO "api_usage_log" VALUES(79,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',2,'2025-12-11 00:20:18');
INSERT INTO "api_usage_log" VALUES(80,NULL,'/api/internal/discogs-sync','POST',429,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',3,'2025-12-11 00:20:26');
INSERT INTO "api_usage_log" VALUES(81,NULL,'/api/internal/discogs-stats','GET',404,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',4,'2025-12-11 00:20:33');
INSERT INTO "api_usage_log" VALUES(82,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',2,'2025-12-11 00:20:33');
INSERT INTO "api_usage_log" VALUES(83,NULL,'/api/internal/discogs-sync','POST',429,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',3,'2025-12-11 00:20:35');
INSERT INTO "api_usage_log" VALUES(84,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',19,'2025-12-11 00:20:37');
INSERT INTO "api_usage_log" VALUES(85,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',39,'2025-12-11 00:20:37');
INSERT INTO "api_usage_log" VALUES(86,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',33,'2025-12-11 00:20:43');
INSERT INTO "api_usage_log" VALUES(87,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',17,'2025-12-11 00:20:43');
INSERT INTO "api_usage_log" VALUES(88,NULL,'/api/internal/discogs-sync','POST',429,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',2,'2025-12-11 00:20:49');
INSERT INTO "api_usage_log" VALUES(89,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',13,'2025-12-11 00:20:54');
INSERT INTO "api_usage_log" VALUES(90,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',26,'2025-12-11 00:20:54');
INSERT INTO "api_usage_log" VALUES(91,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',61,'2025-12-11 00:22:41');
INSERT INTO "api_usage_log" VALUES(92,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',11,'2025-12-11 00:22:41');
INSERT INTO "api_usage_log" VALUES(93,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',13,'2025-12-11 00:22:48');
INSERT INTO "api_usage_log" VALUES(94,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',22,'2025-12-11 00:22:48');
INSERT INTO "api_usage_log" VALUES(95,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',19,'2025-12-11 00:22:59');
INSERT INTO "api_usage_log" VALUES(96,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',24,'2025-12-11 00:22:59');
INSERT INTO "api_usage_log" VALUES(97,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',10,'2025-12-11 00:23:03');
INSERT INTO "api_usage_log" VALUES(98,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',26,'2025-12-11 00:23:03');
INSERT INTO "api_usage_log" VALUES(99,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',10,'2025-12-11 00:23:04');
INSERT INTO "api_usage_log" VALUES(100,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',24,'2025-12-11 00:23:04');
INSERT INTO "api_usage_log" VALUES(101,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',10,'2025-12-11 00:23:19');
INSERT INTO "api_usage_log" VALUES(102,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',14,'2025-12-11 00:23:29');
INSERT INTO "api_usage_log" VALUES(103,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',22,'2025-12-11 00:23:33');
INSERT INTO "api_usage_log" VALUES(104,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',12,'2025-12-11 00:23:33');
INSERT INTO "api_usage_log" VALUES(105,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',12,'2025-12-11 00:23:48');
INSERT INTO "api_usage_log" VALUES(106,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',60658,'2025-12-11 00:23:50');
INSERT INTO "api_usage_log" VALUES(107,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',11,'2025-12-11 00:23:51');
INSERT INTO "api_usage_log" VALUES(108,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',22,'2025-12-11 00:23:52');
INSERT INTO "api_usage_log" VALUES(109,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',10,'2025-12-11 00:23:55');
INSERT INTO "api_usage_log" VALUES(110,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',20,'2025-12-11 00:23:55');
INSERT INTO "api_usage_log" VALUES(111,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',12,'2025-12-11 00:24:10');
INSERT INTO "api_usage_log" VALUES(112,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',10,'2025-12-11 00:24:20');
INSERT INTO "api_usage_log" VALUES(113,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',11,'2025-12-11 00:24:30');
INSERT INTO "api_usage_log" VALUES(114,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',59780,'2025-12-11 00:24:36');
INSERT INTO "api_usage_log" VALUES(115,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',7,'2025-12-11 00:24:40');
INSERT INTO "api_usage_log" VALUES(116,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',19,'2025-12-11 00:24:43');
INSERT INTO "api_usage_log" VALUES(117,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',22,'2025-12-11 00:24:43');
INSERT INTO "api_usage_log" VALUES(118,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',8,'2025-12-11 00:24:45');
INSERT INTO "api_usage_log" VALUES(119,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',23,'2025-12-11 00:24:45');
INSERT INTO "api_usage_log" VALUES(120,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',12,'2025-12-11 00:25:00');
INSERT INTO "api_usage_log" VALUES(121,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',13,'2025-12-11 00:25:10');
INSERT INTO "api_usage_log" VALUES(122,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',80,'2025-12-11 00:25:37');
INSERT INTO "api_usage_log" VALUES(123,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',24,'2025-12-11 00:25:37');
INSERT INTO "api_usage_log" VALUES(124,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',10,'2025-12-11 00:25:52');
INSERT INTO "api_usage_log" VALUES(125,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',9,'2025-12-11 00:26:02');
INSERT INTO "api_usage_log" VALUES(126,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',41,'2025-12-11 00:26:08');
INSERT INTO "api_usage_log" VALUES(127,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',19,'2025-12-11 00:26:08');
INSERT INTO "api_usage_log" VALUES(128,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',11,'2025-12-11 00:26:11');
INSERT INTO "api_usage_log" VALUES(129,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',24,'2025-12-11 00:26:11');
INSERT INTO "api_usage_log" VALUES(130,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',8,'2025-12-11 00:26:26');
INSERT INTO "api_usage_log" VALUES(131,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',12,'2025-12-11 00:26:31');
INSERT INTO "api_usage_log" VALUES(132,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',29,'2025-12-11 00:26:31');
INSERT INTO "api_usage_log" VALUES(133,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',12,'2025-12-11 00:26:46');
INSERT INTO "api_usage_log" VALUES(134,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',61452,'2025-12-11 00:26:51');
INSERT INTO "api_usage_log" VALUES(135,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',7,'2025-12-11 00:26:56');
INSERT INTO "api_usage_log" VALUES(136,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',10,'2025-12-11 00:27:06');
INSERT INTO "api_usage_log" VALUES(137,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',10,'2025-12-11 00:27:16');
INSERT INTO "api_usage_log" VALUES(138,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',8,'2025-12-11 00:27:26');
INSERT INTO "api_usage_log" VALUES(139,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',58177,'2025-12-11 00:27:32');
INSERT INTO "api_usage_log" VALUES(140,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',9,'2025-12-11 00:27:36');
INSERT INTO "api_usage_log" VALUES(141,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',8,'2025-12-11 00:27:46');
INSERT INTO "api_usage_log" VALUES(142,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',18,'2025-12-11 00:27:47');
INSERT INTO "api_usage_log" VALUES(143,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',15,'2025-12-11 00:27:47');
INSERT INTO "api_usage_log" VALUES(144,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',48,'2025-12-11 00:28:02');
INSERT INTO "api_usage_log" VALUES(145,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',27,'2025-12-11 00:28:02');
INSERT INTO "api_usage_log" VALUES(146,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',63474,'2025-12-11 00:28:38');
INSERT INTO "api_usage_log" VALUES(147,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',53988,'2025-12-11 00:28:58');
INSERT INTO "api_usage_log" VALUES(148,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',61040,'2025-12-11 00:30:01');
INSERT INTO "api_usage_log" VALUES(149,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',61406,'2025-12-11 00:31:04');
INSERT INTO "api_usage_log" VALUES(150,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',11,'2025-12-11 00:31:41');
INSERT INTO "api_usage_log" VALUES(151,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',23,'2025-12-11 00:31:41');
INSERT INTO "api_usage_log" VALUES(152,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',60956,'2025-12-11 00:32:07');
INSERT INTO "api_usage_log" VALUES(153,NULL,'/api/internal/discogs-enrich','POST',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',57402,'2025-12-11 00:32:44');
INSERT INTO "api_usage_log" VALUES(154,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',38,'2025-12-11 00:38:44');
INSERT INTO "api_usage_log" VALUES(155,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',10,'2025-12-11 00:38:44');
INSERT INTO "api_usage_log" VALUES(156,NULL,'/api/internal/discogs-stats','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',20,'2025-12-11 00:46:11');
INSERT INTO "api_usage_log" VALUES(157,NULL,'/api/internal/discogs-enrichment-status','GET',200,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',8,'2025-12-11 00:46:11');
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  provider TEXT NOT NULL,  
  
  
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,  
  
  
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,  
  expires_at TEXT,
  
  
  provider_user_id TEXT,
  provider_username TEXT,
  
  
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO "oauth_tokens" VALUES('93b98d22681e5a2def05e0a858b74ebb','default','discogs','bW0h+2kRDnAP1cZxkf8t7t8T1cxEw8aI7gq28DT0mNfksFd7sgGuaYCN8FxlQaBOHyX/vB0MTawxFpgvCQGheXOe9tc=','Pe7KqqEX3qZn9+aJLGfmTvPjcp+oJeWLS9ch4K2w7NcBMuwjjNjrV2f1K0tGn2fh1YNmntU9acOIuzqnrNIzO4zTBKg=','OAuth1',NULL,NULL,'2579319','elezea-records','2025-12-11 00:20:18','2025-12-11 00:20:18');
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" VALUES(1,'001_initial.sql','2025-12-11 00:18:03');
INSERT INTO "d1_migrations" VALUES(2,'002_api_keys.sql','2025-12-11 00:18:03');
INSERT INTO "d1_migrations" VALUES(3,'003_user_username.sql','2025-12-11 00:18:03');
INSERT INTO "d1_migrations" VALUES(4,'004_standardize_user_ids.sql','2025-12-11 00:18:04');
INSERT INTO "d1_migrations" VALUES(5,'005_oauth_tokens.sql','2025-12-11 00:18:04');
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" VALUES('api_usage_log',157);
INSERT INTO "sqlite_sequence" VALUES('d1_migrations',5);
CREATE INDEX idx_searches_user_time ON searches(user_id, searched_at DESC);
CREATE INDEX idx_recent_searches_time ON recent_searches(searched_at DESC);
CREATE INDEX idx_discogs_user ON discogs_releases(user_id);
CREATE INDEX idx_discogs_added ON discogs_releases(user_id, date_added DESC);
CREATE INDEX idx_discogs_master ON discogs_releases(master_id) WHERE master_enriched = 0;
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_usage_key_time ON api_usage_log(api_key_id, created_at DESC);
CREATE INDEX idx_usage_time ON api_usage_log(created_at DESC);
CREATE UNIQUE INDEX idx_oauth_user_provider ON oauth_tokens(user_id, provider);
CREATE INDEX idx_oauth_provider ON oauth_tokens(provider);
CREATE UNIQUE INDEX idx_users_username ON users(username);