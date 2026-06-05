-- SanusBio Migration 04: RFID, 8-Hour Light, Rabies Nullable, Vacc Administered-By
-- Run AFTER 03_cleaning_reports.sql
-- Safe to re-run

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

-- 1. Make next_rabies_vaccine_due nullable (not required at creation)
ALTER TABLE `ferret_qr005`
  MODIFY COLUMN `next_rabies_vaccine_due` DATE NULL DEFAULT NULL;

-- 2. Add eight_hour_light boolean to ferret_qr005 (not shown at creation, not required)
SET @dbname = 'sanusbio';
SET @tablename = 'ferret_qr005';
SET @columnname = 'eight_hour_light';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE ferret_qr005 ADD COLUMN eight_hour_light TINYINT(1) NOT NULL DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. Add administered_by to vaccination_event (who gave the shot)
SET @tablename = 'vaccination_event';
SET @columnname = 'administered_by';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE vaccination_event ADD COLUMN administered_by VARCHAR(100) NULL DEFAULT NULL AFTER recorded_by'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 4. rfid_assignment table already exists from 01_schema.sql — no changes needed.
--    Verify it has the columns we need (safe no-op check):
--    rfid VARCHAR(45), ferret_id INT, assigned_date DATE, unassigned_date DATE, reason, notes

SET FOREIGN_KEY_CHECKS=1;