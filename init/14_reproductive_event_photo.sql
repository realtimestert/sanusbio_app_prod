-- SanusBio Migration 14: Reproductive Event Photo (e.g. litter photo)
-- Run AFTER 13_room_light_schedule.sql
-- Safe to re-run

USE sanusbio;

SET @dbname = 'sanusbio';
SET @tablename = 'reproductive_event';
SET @columnname = 'photo_url';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE reproductive_event ADD COLUMN photo_url VARCHAR(255) NULL DEFAULT NULL AFTER notes'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;