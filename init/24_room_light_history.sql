-- SanusBio Migration 24: Room Light History (audit trail of schedule changes)
-- Run AFTER 23_repro_status_and_litter_kits.sql
-- Safe to re-run
--
-- Stores every time a room's light schedule flipped between 8-hour (winter/dark)
-- and 16-hour (summer/standard). Combined with ferret_location_history this lets
-- us reconstruct continuous cycle periods for each animal even when they move
-- between rooms that share the same schedule.
--
-- The existing room_light_schedule table remains the live current-state cache
-- used by the UI and by auto-mode cascade on room toggles / moves.

USE sanusbio;

CREATE TABLE IF NOT EXISTS `sanusbio`.`room_light_history` (
  `light_history_id`   INT          NOT NULL AUTO_INCREMENT,
  `room_id`            INT          NOT NULL,
  `change_date`        DATE         NOT NULL COMMENT 'First day the new schedule applied',
  `eight_hour_light`   TINYINT(1)   NOT NULL COMMENT '1 = 8-hour / winter / dark, 0 = 16-hour / summer / standard',
  `source`             VARCHAR(50)  NULL DEFAULT 'import' COMMENT 'import | app | manual',
  `imported_at`        TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`light_history_id`),
  UNIQUE KEY `uq_room_change_date` (`room_id`, `change_date`),
  INDEX `idx_room_date` (`room_id`, `change_date`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
