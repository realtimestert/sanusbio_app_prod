-- SanusBio Migration 15: Light Schedule Duration, Pre-ID Kit Deaths, Litter Care Log
-- Run AFTER 14_reproductive_event_photo.sql
-- Safe to re-run
-- 1.9.4 7/22/26

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Room Light Schedule: track when the CURRENT state (8-hour or standard)
--    started, so we can show "on 8-hour light for X weeks" / "on standard
--    light for X weeks" regardless of which state a room is in.
-- ─────────────────────────────────────────────────────────────────────────────
SET @dbname = 'sanusbio';
SET @tablename = 'room_light_schedule';
SET @columnname = 'light_state_since';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE room_light_schedule ADD COLUMN light_state_since DATE NULL DEFAULT NULL AFTER eight_hour_light'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Backfill: assume the current state has been in place since it was last touched
UPDATE room_light_schedule
SET light_state_since = DATE(updated_at)
WHERE light_state_since IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Pre-ID Kit Deaths — kits that die before being tagged/individuated as a
--    ferret record. Tied to litter_log rather than ferret_qr005.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sanusbio`.`litter_kit_death` (
  `kit_death_id`   INT          NOT NULL AUTO_INCREMENT,
  `litter_log_id`  INT          NOT NULL,
  `death_date`     DATE         NOT NULL,
  `cause_category` ENUM('mother_ate','fell_from_cage','crushed','failure_to_thrive','unknown','other') NOT NULL,
  `notes`          TEXT         NULL DEFAULT NULL,
  `treatments`     TEXT         NULL DEFAULT NULL COMMENT 'Any treatment/intervention attempted before death',
  `recorded_by`    VARCHAR(100) NULL DEFAULT NULL,
  `created_at`     TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`kit_death_id`),
  INDEX `idx_litter` (`litter_log_id` ASC),
  CONSTRAINT `fk_kit_death_litter`
    FOREIGN KEY (`litter_log_id`)
    REFERENCES `sanusbio`.`litter_log` (`litter_log_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Litter Care Log — repeatable, dated maternity events per litter
--    (kit weighing, nest box changes, supplemental feeding, general feeding
--    checks) prior to individual kits being tagged with their own ferret ID.
--    Mirrors the health_event pattern used for individual ferrets.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sanusbio`.`litter_care_event` (
  `care_event_id`  INT          NOT NULL AUTO_INCREMENT,
  `litter_log_id`  INT          NOT NULL,
  `event_type`     ENUM('weight','nest_change','supplemental_feeding','feeding_check','other') NOT NULL,
  `event_date`     DATE         NOT NULL,
  `weight_grams`   INT          NULL DEFAULT NULL COMMENT 'Litter/kit weight for weight-type events',
  `kit_count`      INT          NULL DEFAULT NULL COMMENT 'How many kits this weight/feeding applied to',
  `feed_type`      VARCHAR(100) NULL DEFAULT NULL COMMENT 'e.g. Esbilac, goat milk, etc — for supplemental_feeding',
  `notes`          TEXT         NULL DEFAULT NULL,
  `recorded_by`    VARCHAR(100) NULL DEFAULT NULL,
  `created_at`     TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`care_event_id`),
  INDEX `idx_litter`     (`litter_log_id` ASC),
  INDEX `idx_event_type` (`event_type` ASC),
  INDEX `idx_event_date` (`event_date` ASC),
  CONSTRAINT `fk_care_event_litter`
    FOREIGN KEY (`litter_log_id`)
    REFERENCES `sanusbio`.`litter_log` (`litter_log_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS=1;