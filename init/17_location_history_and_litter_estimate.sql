-- SanusBio Migration 17: Location History Backfill, Litter Estimate Window, Death-on-Board Tracking
-- Run AFTER 16_ferret_light_cycle.sql
-- Safe to re-run
--
-- 1. ferret_location_history already exists (01_schema.sql) but has never been
--    written to by the app. Backfill one "since birth" row per ferret from
--    their current address so history isn't empty going forward, then the
--    app will append proper move_out/move_in rows on every future move.
-- 2. reproductive_event.pulled_date — date a mated female was separated from
--    the male. Used with event_date (mating date) to compute an expected
--    litter date RANGE (gestation ~6 weeks / 42 days from each anchor).
-- 3. ferret_qr005.death_female_status — snapshot of female_status at time of
--    death, so a mother who dies while on the Reproductive Status Board
--    (estrus/mated/littered/weaned) is flagged and queryable later.

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

-- 1. Backfill location history (only for ferrets with no existing rows)
INSERT INTO ferret_location_history (move_in, ferret_id, address_id)
SELECT f.birth_date, f.Ferret_QR005_id, f.address_id
FROM ferret_qr005 f
WHERE f.address_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ferret_location_history flh WHERE flh.ferret_id = f.Ferret_QR005_id
  );

-- 2. pulled_date on reproductive_event
SET @dbname = 'sanusbio';
SET @tablename = 'reproductive_event';
SET @columnname = 'pulled_date';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE reproductive_event ADD COLUMN pulled_date DATE NULL DEFAULT NULL COMMENT 'Date female was separated/pulled from the male after a mated event' AFTER event_date"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. death_female_status on ferret_qr005
SET @tablename = 'ferret_qr005';
SET @columnname = 'death_female_status';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE ferret_qr005 ADD COLUMN death_female_status ENUM('estrus','mated','littered','weaned') NULL DEFAULT NULL COMMENT 'female_status snapshot at time of death, set only if she died while active on the Reproductive Status Board'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET FOREIGN_KEY_CHECKS=1;
