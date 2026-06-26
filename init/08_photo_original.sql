-- SanusBio Migration 08: photo_original_url column
-- Run AFTER 07_distribution.sql
-- Safe to re-run

USE sanusbio;

SET @dbname = 'sanusbio';
SET @tablename = 'ferret_qr005';
SET @columnname = 'photo_original_url';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE ferret_qr005 ADD COLUMN photo_original_url VARCHAR(255) NULL DEFAULT NULL AFTER photo_url'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;