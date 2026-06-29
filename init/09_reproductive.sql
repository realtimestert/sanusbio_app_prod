-- SanusBio Migration 09: Reproductive Events & Female Status
-- Run AFTER 08_photo_original.sql
-- Safe to re-run

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

-- 1. Reproductive event log (estrus, mating, litter, wean, no-litter)
CREATE TABLE IF NOT EXISTS `sanusbio`.`reproductive_event` (
  `event_id`      INT          NOT NULL AUTO_INCREMENT,
  `ferret_id`     INT          NOT NULL,
  `event_type`    ENUM('estrus','mated','littered','weaned','no_litter') NOT NULL,
  `event_date`    DATE         NOT NULL,
  `partner_id`    INT          NULL DEFAULT NULL COMMENT 'Male ferret used for mating',
  `notes`         TEXT         NULL DEFAULT NULL,
  `recorded_by`   VARCHAR(100) NULL DEFAULT NULL,
  `created_at`    TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  INDEX `idx_ferret`     (`ferret_id`  ASC),
  INDEX `idx_event_type` (`event_type` ASC),
  INDEX `idx_event_date` (`event_date` ASC),
  CONSTRAINT `fk_repro_ferret`
    FOREIGN KEY (`ferret_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`),
  CONSTRAINT `fk_repro_partner`
    FOREIGN KEY (`partner_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 2. female_status column on ferret_qr005 (tracks current reproductive state)
SET @dbname = 'sanusbio';
SET @tablename = 'ferret_qr005';
SET @col = 'female_status';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @col) > 0,
  'SELECT 1',
  "ALTER TABLE ferret_qr005 ADD COLUMN female_status ENUM('baseline','estrus','mated','littered','weaned') NULL DEFAULT NULL COMMENT 'Reproductive status for females ≥20 weeks'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. mating_restriction column on ferret_qr005
SET @col = 'mating_restriction';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @col) > 0,
  'SELECT 1',
  'ALTER TABLE ferret_qr005 ADD COLUMN mating_restriction TEXT NULL DEFAULT NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET FOREIGN_KEY_CHECKS=1;