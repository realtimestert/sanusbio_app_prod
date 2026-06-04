-- SanusBio Migration 03: Cleaner Role + Room Cleaning Reports
-- Run AFTER 02_migrations.sql
-- Safe to re-run

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

-- Add 'cleaner' to user role enum
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('admin', 'research', 'maternity', 'caretaker', 'cleaner') NOT NULL;

-- Create room_cleaning_report table
CREATE TABLE IF NOT EXISTS `sanusbio`.`room_cleaning_report` (
  `report_id`            INT NOT NULL AUTO_INCREMENT,
  `reported_by_user_id`  INT NOT NULL,
  `reported_by_name`     VARCHAR(100) NOT NULL,
  `rooms_cleaned`        VARCHAR(255) NOT NULL COMMENT 'Comma-separated room IDs',
  `inside_cage_cleaning` TINYINT(1) NOT NULL DEFAULT 0,
  `tray_cleaning`        TINYINT(1) NOT NULL DEFAULT 0,
  `sweeping_mopping`     TINYINT(1) NOT NULL DEFAULT 0,
  `food_water_check`     TINYINT(1) NOT NULL DEFAULT 0,
  `had_issues`           TINYINT(1) NOT NULL DEFAULT 0,
  `issue_description`    TEXT NULL DEFAULT NULL,
  `signature_data`       MEDIUMTEXT NOT NULL COMMENT 'Base64 PNG of signature',
  `submitted_at`         TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`report_id`),
  INDEX `idx_submitted_at` (`submitted_at` ASC),
  INDEX `idx_user` (`reported_by_user_id` ASC),
  CONSTRAINT `fk_cleaning_report_user`
    FOREIGN KEY (`reported_by_user_id`)
    REFERENCES `sanusbio`.`users` (`user_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS=1;
