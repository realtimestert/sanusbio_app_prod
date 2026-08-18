-- SanusBio migration 21 | 2026-08-17
-- Drop confirmed orphaned / retired tables
--
-- push_subscriptions     : never referenced by any application code
-- estrus_&_mating_summary: legacy Workbench table; only residual DELETE
--                          references remained (never written or read)
-- assignments            : feature fully retired (UI tab and routes removed
--                          in v1.10.x); only residual DELETE + activity_log
--                          filter remained
--
-- Optional: if you want to keep a copy of any historical assignment rows,
-- uncomment the CREATE TABLE line below before running this migration.

CREATE TABLE IF NOT EXISTS assignments_archive AS SELECT * FROM assignments;

DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS `estrus_&_mating_summary`;
DROP TABLE IF EXISTS assignments;
