-- SanusBio Migration 05: Ferret Color + Expanded Description
-- Run AFTER 04_new_features.sql
-- Safe to re-run

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

-- 1. Expand description from VARCHAR(45) to TEXT
ALTER TABLE `ferret_qr005`
  MODIFY COLUMN `description` TEXT NULL DEFAULT NULL;

-- 2. Add color column (safe re-run guard)
SET @dbname = 'sanusbio';
SET @tablename = 'ferret_qr005';
SET @columnname = 'color';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE ferret_qr005 ADD COLUMN color VARCHAR(100) NULL DEFAULT NULL AFTER description'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET FOREIGN_KEY_CHECKS=1;