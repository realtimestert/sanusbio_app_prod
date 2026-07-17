-- SanusBio Migration 13: Room-Level 8-Hour Light Schedule
-- Run AFTER 12_exam_notes.sql
-- Safe to re-run

USE sanusbio;

CREATE TABLE IF NOT EXISTS `sanusbio`.`room_light_schedule` (
  `room_id` INT NOT NULL,
  `eight_hour_light` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`room_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Backfill: if any ferret in a room currently has the old ferret-level
-- eight_hour_light flag set, mark that whole room as on the 8-hour schedule
-- (this preserves Room 12's current setting).
INSERT INTO room_light_schedule (room_id, eight_hour_light)
SELECT a.room_id, 1
FROM ferret_qr005 f
JOIN address a ON f.address_id = a.address_id
WHERE f.eight_hour_light = 1 AND a.room_id IS NOT NULL AND a.room_id > 0
GROUP BY a.room_id
ON DUPLICATE KEY UPDATE eight_hour_light = 1;