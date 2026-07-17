-- SanusBio Migration 12: Exam Notes
-- Run after 11_mating_restrictions.sql
-- Safe to re-run

USE sanusbio;

SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS `sanusbio`.`exam_note` (
    `exam_note_id`  INT             NOT NULL AUTO_INCREMENT,
    `ferret_id`     INT             NOT NULL,
    `exam_date`     DATE            NOT NULL,
    `weight_grams`  INT             NULL DEFAULT NULL,
    `status`        VARCHAR(150)    NULL DEFAULT NULL COMMENT 'e.g. BAR, Active',
    `notes`         TEXT            NULL DEFAULT NULL,
    `performed_by`  VARCHAR(100)    NULL DEFAULT NULL,
    `recorded_by`   VARCHAR(100)    NULL DEFAULT NULL,
    `created_at`    TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`exam_note_id`),
    INDEX `idx_ferret`      (`ferret_id`    ASC),
    INDEX `idx_exam_date`   (`exam_date`    ASC),
    CONSTRAINT `fk_exam_note_ferret`
        FOREIGN KEY (`ferret_id`)
        REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Backfill: turn each ferret's single existing exam_log entry into its first history row
INSERT INTO exam_note (ferret_id, exam_date, notes, performed_by, recorded_by)
SELECT f.Ferret_QR005_id, COALESCE(mi.last_exam_date, CURDATE()), mi.exam_log, mi.performed_by, mi.performed_by
FROM ferret_qr005 f
JOIN medical_info mi ON f.medical_info_id = mi.medical_info_id
WHERE mi.exam_log IS NOT NULL AND TRIM(mi.exam_log) <> ''
  AND NOT EXISTS (SELECT 1 FROM exam_note en WHERE en.ferret_id = f.Ferret_QR005_id);

SET FOREIGN_KEY_CHECKS=1;