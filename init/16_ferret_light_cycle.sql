-- SanusBio Migration 16: Ferret-Level Light Cycle Tracking
-- Run AFTER 15_maternity_and_light_duration.sql
-- Safe to re-run
--
-- Duration on the 8-hour (winter) vs standard (summer) light cycle is now
-- tracked per FERRET, not per room, since it needs to follow the animal when
-- it's moved between rooms. The room's own eight_hour_light flag (from
-- migration 04 / room_light_schedule) is still the "current schedule" a room
-- is set to — it's what an auto-mode ferret inherits when moved into that
-- room, or when the room's schedule is flipped while the ferret stays put.

USE sanusbio;

SET @dbname = 'sanusbio';
SET @tablename = 'ferret_qr005';

-- light_state_since: when THIS ferret's current light cycle state began
SET @columnname = 'light_state_since';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE ferret_qr005 ADD COLUMN light_state_since DATE NULL DEFAULT NULL AFTER eight_hour_light'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- light_mode: 'auto' follows the destination room's schedule on every move
-- (and updates immediately if the room's own schedule is flipped while the
-- ferret stays put); 'manual' is staff-controlled and ignores room changes
SET @columnname = 'light_mode';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE ferret_qr005 ADD COLUMN light_mode ENUM('auto','manual') NOT NULL DEFAULT 'auto' AFTER light_state_since"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Backfill: seed each ferret's light state from its current room's schedule,
-- since that's the best information we have about its history so far
UPDATE ferret_qr005 f
LEFT JOIN address a ON f.address_id = a.address_id
LEFT JOIN room_light_schedule rls ON a.room_id = rls.room_id
SET f.eight_hour_light  = COALESCE(rls.eight_hour_light, f.eight_hour_light, 0),
    f.light_state_since = COALESCE(rls.light_state_since, CURDATE())
WHERE f.light_state_since IS NULL;