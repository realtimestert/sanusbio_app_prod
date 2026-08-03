-- SanusBio Migration 19: Weight & Grooming Care Schedule Settings
-- Run AFTER 18_litter_surviving_count_backfill.sql
-- Safe to re-run

USE sanusbio;

CREATE TABLE IF NOT EXISTS `sanusbio`.`care_schedule_settings` (
  `id` INT NOT NULL,
  `nail_trim_interval_days` INT NOT NULL DEFAULT 180,
  `bath_interval_days` INT NOT NULL DEFAULT 180,
  `weight_warn_days` INT NOT NULL DEFAULT 30,
  `weight_critical_days` INT NOT NULL DEFAULT 45,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

INSERT IGNORE INTO care_schedule_settings (id) VALUES (1);