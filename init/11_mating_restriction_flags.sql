-- SanusBio Migration 11: Mating Restriction Checkboxes (Over Age / Under Age / Albino / Other)
-- Run AFTER 10_breeding_retired.sql
-- Safe to re-run

USE sanusbio;

SET @dbname = 'sanusbio';
SET @tablename = 'ferret_qr005';
SET @columnname = 'mating_restriction_flags';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE ferret_qr005 ADD COLUMN mating_restriction_flags VARCHAR(100) NULL DEFAULT NULL COMMENT 'Comma-separated: over_age,under_age,albino,other' AFTER mating_restriction"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Backfill: preserve any existing free-text restriction as an "Other" entry
UPDATE ferret_qr005
SET mating_restriction_flags = 'other'
WHERE mating_restriction IS NOT NULL
  AND TRIM(mating_restriction) <> ''
  AND (mating_restriction_flags IS NULL OR mating_restriction_flags = '');