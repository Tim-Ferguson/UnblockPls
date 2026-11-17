-- Demo data for local testing only (npm run seed). Handles are made up.
DELETE FROM declines; DELETE FROM appeals; DELETE FROM users; DELETE FROM sqlite_sequence WHERE name = 'appeals';
INSERT INTO users (id, handle, handle_lower, name, avatar, created_at, updated_at) VALUES
 ('dev:maya_demo',   'maya_demo',   'maya_demo',   'Maya Okafor',      NULL, unixepoch()*1000, unixepoch()*1000),
 ('dev:jonas_demo',  'jonas_demo',  'jonas_demo',  'Jonas Lindqvist',  NULL, unixepoch()*1000, unixepoch()*1000),
 ('dev:priya_demo',  'priya_demo',  'priya_demo',  'Priya Raman',      NULL, unixepoch()*1000, unixepoch()*1000),
 ('dev:teo_demo',    'teo_demo',    'teo_demo',    'Teo Marchetti',    NULL, unixepoch()*1000, unixepoch()*1000),
 ('dev:hana_demo',   'hana_demo',   'hana_demo',   'Hana Sato',        NULL, unixepoch()*1000, unixepoch()*1000),
 ('dev:wes_demo',    'wes_demo',    'wes_demo',    'Wes Abernathy',    NULL, unixepoch()*1000, unixepoch()*1000);
INSERT INTO appeals (from_id, to_handle, note, created_at, seen_at, granted_at, declined_at) VALUES
 ('dev:jonas_demo', 'maya_demo', 'I corrected your grammar under a post about your grandmother. That was a bad call. I''m sorry.', unixepoch()*1000 - 86400000*6, unixepoch()*1000 - 86400000*5, unixepoch()*1000 - 86400000*5, NULL),
 ('dev:priya_demo', 'maya_demo', 'I quote-posted you with "ratio" and then lost the ratio. Lesson learned.', unixepoch()*1000 - 86400000*2, unixepoch()*1000 - 86400000, NULL, NULL),
 ('dev:teo_demo',   'maya_demo', 'I replied "well, actually" eleven times in one thread. Twelve, if you count this one. Sorry.', unixepoch()*1000 - 3600000*5, NULL, NULL, NULL),
 ('dev:wes_demo',   'maya_demo', '', unixepoch()*1000 - 3600000*2, NULL, NULL, NULL),
 ('dev:hana_demo',  'maya_demo', 'unblock me or else', unixepoch()*1000 - 86400000*9, unixepoch()*1000 - 86400000*8, NULL, unixepoch()*1000 - 86400000*8),
 ('dev:maya_demo',  'jonas_demo','You blocked me after the pineapple pizza poll. I voted wrong and I know it now.', unixepoch()*1000 - 86400000*3, unixepoch()*1000 - 86400000*2, NULL, NULL),
 ('dev:maya_demo',  'teo_demo',  'I live-posted the finale. No spoiler tags. I''d block me too.', unixepoch()*1000 - 86400000*12, unixepoch()*1000 - 86400000*11, unixepoch()*1000 - 86400000*10, NULL),
 ('dev:maya_demo',  'zz_demo_nobody', '', unixepoch()*1000 - 3600000*30, NULL, NULL, NULL),
 ('dev:wes_demo',   'priya_demo','I mansplained your own paper to you. I have now read the paper.', unixepoch()*1000 - 86400000*4, unixepoch()*1000 - 86400000*3, unixepoch()*1000 - 3600000*20, NULL),
 ('dev:hana_demo',  'jonas_demo','I sent you 40 crypto DMs in 2021. I''m better now.', unixepoch()*1000 - 86400000*7, unixepoch()*1000 - 86400000*6, unixepoch()*1000 - 3600000*50, NULL);
