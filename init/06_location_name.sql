-- SanusBio Migration 06: Room Name on Address + Position Label
-- Run AFTER 05_color_description.sql
-- Safe to re-run
--
-- NOTE: room_lighting (VARCHAR) is repurposed to store cage position:
--       'Top', 'Middle', or 'Bottom'. No schema type change needed.
--       Existing values (if any) will remain as-is until edited.

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

-- Add room_name (e.g. "JB", "Breeding", "ISO") to address
SET @dbname = 'sanusbio';
SET @tablename = 'address';
SET @columnname = 'room_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE address ADD COLUMN room_name VARCHAR(50) NULL DEFAULT NULL AFTER room_id'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET FOREIGN_KEY_CHECKS=1;