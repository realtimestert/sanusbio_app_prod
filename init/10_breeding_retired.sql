-- SanusBio Migration 10: Breeding Retired flag for females
-- Run AFTER 09_reproductive.sql
-- Safe to re-run

USE sanusbio;

SET @dbname = 'sanusbio';
SET @tablename = 'ferret_qr005';
SET @columnname = 'breeding_retired';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE ferret_qr005 ADD COLUMN breeding_retired TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''Excludes female from Reproductive Status Board (over-aged / retired breeder)'''
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;