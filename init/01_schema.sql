-- MySQL Workbench Forward Engineering

SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- -----------------------------------------------------
-- Schema mydb
-- -----------------------------------------------------
-- -----------------------------------------------------
-- Schema sanusbio
-- -----------------------------------------------------

-- -----------------------------------------------------
-- Schema sanusbio
-- -----------------------------------------------------
CREATE SCHEMA IF NOT EXISTS `sanusbio` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci ;
USE `sanusbio` ;

-- -----------------------------------------------------
-- Table `sanusbio`.`users`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`users` (
  `user_id` INT NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `role` ENUM('admin', 'research', 'maternity', 'caretaker') NOT NULL,
  `full_name` VARCHAR(100) NULL DEFAULT NULL,
  `active` TINYINT(1) NULL DEFAULT '1',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE INDEX `username` (`username` ASC) VISIBLE,
  UNIQUE INDEX `email` (`email` ASC) VISIBLE,
  INDEX `idx_username` (`username` ASC) VISIBLE,
  INDEX `idx_role` (`role` ASC) VISIBLE)
ENGINE = InnoDB
AUTO_INCREMENT = 2
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`activity_log`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`activity_log` (
  `log_id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `action` VARCHAR(100) NOT NULL,
  `table_name` VARCHAR(50) NULL DEFAULT NULL,
  `record_id` INT NULL DEFAULT NULL,
  `details` TEXT NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`),
  INDEX `idx_user_action` (`user_id` ASC, `action` ASC) VISIBLE,
  INDEX `idx_created_at` (`created_at` ASC) VISIBLE,
  CONSTRAINT `activity_log_ibfk_1`
    FOREIGN KEY (`user_id`)
    REFERENCES `sanusbio`.`users` (`user_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`address`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`address` (
  `address_id` INT NOT NULL,
  `room_id` INT NOT NULL,
  `cage_address` VARCHAR(5) NULL DEFAULT NULL,
  `room_lighting` VARCHAR(45) NULL DEFAULT NULL,
  `maintenance` VARCHAR(255) NULL DEFAULT NULL,
  PRIMARY KEY (`address_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`estrus_check_log`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`estrus_check_log` (
  `estrus_check_log_id` INT NOT NULL,
  `estrus_status` VARCHAR(45) NULL DEFAULT NULL,
  `vulva_description` VARCHAR(45) NULL DEFAULT NULL,
  `formed_observation` DATE NULL DEFAULT NULL,
  `comments` VARCHAR(255) NULL DEFAULT NULL,
  `reported_by` VARCHAR(45) NULL DEFAULT NULL,
  `created_date` DATE NULL DEFAULT NULL,
  `created_by` VARCHAR(45) NULL DEFAULT NULL,
  `in_estrus` ENUM('0', '1') NULL DEFAULT NULL,
  PRIMARY KEY (`estrus_check_log_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`females_to_mate`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`females_to_mate` (
  `females_to_mate_id` INT NOT NULL,
  `primary` VARCHAR(45) NULL DEFAULT NULL,
  `mating_link` VARCHAR(45) NULL DEFAULT NULL,
  `date_identified` DATE NULL DEFAULT NULL,
  `recent_history` VARCHAR(300) NULL DEFAULT NULL,
  `address` VARCHAR(45) NULL DEFAULT NULL,
  `genealogy` VARCHAR(500) NULL DEFAULT NULL,
  `kits` VARCHAR(45) NULL DEFAULT NULL,
  PRIMARY KEY (`females_to_mate_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`health_log`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`health_log` (
  `health_log_id` INT NOT NULL,
  `nail_trim_log` VARCHAR(1000) NULL DEFAULT NULL,
  `weight_log` VARCHAR(1000) NULL DEFAULT NULL,
  `bath_history` VARCHAR(1000) NULL DEFAULT NULL,
  PRIMARY KEY (`health_log_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`medical_info`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`medical_info` (
  `medical_info_id` INT NOT NULL,
  `castration_or_spay_date` DATE NULL DEFAULT NULL,
  `castrated_or_spayed` ENUM('y', 'n') NULL DEFAULT NULL,
  `descent_date` DATE NULL DEFAULT NULL,
  `test_collected_last_30_days` VARCHAR(255) NULL DEFAULT NULL,
  `test_result_last_30_days` VARCHAR(255) NULL DEFAULT NULL,
  `weight_loss_or_gain` VARCHAR(45) NULL DEFAULT NULL,
  `lifetime_%_litters/mating` VARCHAR(45) NULL DEFAULT NULL,
  `surgical_procedure_log` VARCHAR(1000) NULL DEFAULT NULL,
  `dead` ENUM('y', 'n') NULL DEFAULT NULL,
  `date_of_death` DATE NULL DEFAULT NULL,
  `cause_of_death` VARCHAR(255) NULL DEFAULT NULL,
  `treatments` VARCHAR(255) NULL DEFAULT NULL,
  `exam_log` VARCHAR(1000) NULL DEFAULT NULL,
  `last_exam_date` DATE NULL DEFAULT NULL,
  `orders` VARCHAR(200) NULL DEFAULT NULL,
  `performed_by` VARCHAR(45) NULL DEFAULT NULL,
  PRIMARY KEY (`medical_info_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`supplier`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`supplier` (
  `supplier_id` INT NOT NULL AUTO_INCREMENT,
  `supplier_name` VARCHAR(100) NOT NULL,
  `contact_info` VARCHAR(255) NULL DEFAULT NULL,
  `supplier_address` VARCHAR(150) NULL DEFAULT NULL,
  `supplier_phone_number` INT NULL DEFAULT NULL,
  PRIMARY KEY (`supplier_id`))
ENGINE = InnoDB
AUTO_INCREMENT = 4
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`ferret_qr005`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`ferret_qr005` (
  `Ferret_QR005_id` INT NOT NULL,
  `animal_id` INT NOT NULL,
  `ferret_name` VARCHAR(45) NOT NULL,
  `location_change_log` VARCHAR(1000) NULL DEFAULT NULL,
  `birth_date` DATE NOT NULL,
  `death_date` DATE NULL DEFAULT NULL,
  `acquisition_by` VARCHAR(45) NULL DEFAULT NULL,
  `weight` INT NOT NULL,
  `next_rabies_vaccine_due` DATE NOT NULL,
  `description` VARCHAR(45) NULL DEFAULT NULL,
  `mother` VARCHAR(45) NULL DEFAULT NULL,
  `father` VARCHAR(45) NULL DEFAULT NULL,
  `mother_id` INT NULL DEFAULT NULL,
  `father_id` INT NULL DEFAULT NULL,
  `supplier` VARCHAR(45) NULL DEFAULT NULL,
  `last_move_to_winter` DATE NULL DEFAULT NULL,
  `last_winter_cycle_completion` DATE NULL DEFAULT NULL,
  `last_move_to_summer` DATE NULL DEFAULT NULL,
  `move_in` DATETIME NULL DEFAULT NULL,
  `move_out` DATETIME NULL DEFAULT NULL,
  `winter_start` DATETIME NULL DEFAULT NULL,
  `winter_end` DATETIME NULL DEFAULT NULL,
  `time_in_winter` INT GENERATED ALWAYS AS (greatest(0,(to_days(least(coalesce(`move_out`,`winter_end`),`winter_end`)) - to_days(greatest(`move_in`,`winter_start`))))) STORED,
  `age_wks` INT NULL DEFAULT NULL,
  `distribution_date` DATE NULL DEFAULT NULL,
  `clip_nails` ENUM('0', '1') NULL DEFAULT NULL,
  `bath` ENUM('0', '1') NULL DEFAULT NULL,
  `litter_id` VARCHAR(7) NULL DEFAULT NULL,
  `litter_date` DATE NULL DEFAULT NULL,
  `purchase_id` VARCHAR(45) NULL DEFAULT NULL,
  `created_by` VARCHAR(45) NULL DEFAULT NULL,
  `photo_url` VARCHAR(255) NULL DEFAULT NULL,
  `dead` ENUM('0', '1') NULL DEFAULT NULL,
  `address_id` INT NOT NULL,
  `medical_info_id` INT NOT NULL,
  `estrus_check_log_id` INT NOT NULL,
  `females_to_mate_id` INT NOT NULL,
  `health_log_id` INT NOT NULL,
  `mother_name` VARCHAR(45) NULL DEFAULT NULL,
  `father_name` VARCHAR(45) NULL DEFAULT NULL,
  `supplier_id` INT NOT NULL,
  PRIMARY KEY (`Ferret_QR005_id`),
  INDEX `fk_ferret_qr005_address_idx` (`address_id` ASC) VISIBLE,
  INDEX `fk_ferret_qr005_medical_info1_idx` (`medical_info_id` ASC) VISIBLE,
  INDEX `fk_ferret_qr005_estrus_check_log1_idx` (`estrus_check_log_id` ASC) VISIBLE,
  INDEX `fk_ferret_qr005_females_to_mate1_idx` (`females_to_mate_id` ASC) VISIBLE,
  INDEX `fk_ferret_qr005_health_log1_idx` (`health_log_id` ASC) VISIBLE,
  INDEX `fk_mother` (`mother_id` ASC) VISIBLE,
  INDEX `fk_father` (`father_id` ASC) VISIBLE,
  INDEX `fk_ferret_qr005_supplier1_idx` (`supplier_id` ASC) VISIBLE,
  CONSTRAINT `fk_father`
    FOREIGN KEY (`father_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`),
  CONSTRAINT `fk_ferret_qr005_address`
    FOREIGN KEY (`address_id`)
    REFERENCES `sanusbio`.`address` (`address_id`),
  CONSTRAINT `fk_ferret_qr005_estrus_check_log1`
    FOREIGN KEY (`estrus_check_log_id`)
    REFERENCES `sanusbio`.`estrus_check_log` (`estrus_check_log_id`),
  CONSTRAINT `fk_ferret_qr005_females_to_mate1`
    FOREIGN KEY (`females_to_mate_id`)
    REFERENCES `sanusbio`.`females_to_mate` (`females_to_mate_id`),
  CONSTRAINT `fk_ferret_qr005_health_log1`
    FOREIGN KEY (`health_log_id`)
    REFERENCES `sanusbio`.`health_log` (`health_log_id`),
  CONSTRAINT `fk_ferret_qr005_medical_info1`
    FOREIGN KEY (`medical_info_id`)
    REFERENCES `sanusbio`.`medical_info` (`medical_info_id`),
  CONSTRAINT `fk_ferret_qr005_supplier1`
    FOREIGN KEY (`supplier_id`)
    REFERENCES `sanusbio`.`supplier` (`supplier_id`),
  CONSTRAINT `fk_mother`
    FOREIGN KEY (`mother_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`assignments`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`assignments` (
  `assignment_id` INT NOT NULL AUTO_INCREMENT,
  `assigned_to` INT NOT NULL,
  `assignment_type` ENUM('cleaning', 'feeding', 'health_check', 'other') NOT NULL,
  `address_id` INT NULL DEFAULT NULL,
  `ferret_id` INT NULL DEFAULT NULL,
  `description` TEXT NULL DEFAULT NULL,
  `due_date` DATE NULL DEFAULT NULL,
  `completed` TINYINT(1) NULL DEFAULT '0',
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_by` INT NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`assignment_id`),
  INDEX `created_by` (`created_by` ASC) VISIBLE,
  INDEX `address_id` (`address_id` ASC) VISIBLE,
  INDEX `ferret_id` (`ferret_id` ASC) VISIBLE,
  INDEX `idx_assigned_completed` (`assigned_to` ASC, `completed` ASC) VISIBLE,
  INDEX `idx_due_date` (`due_date` ASC) VISIBLE,
  CONSTRAINT `assignments_ibfk_1`
    FOREIGN KEY (`assigned_to`)
    REFERENCES `sanusbio`.`users` (`user_id`),
  CONSTRAINT `assignments_ibfk_2`
    FOREIGN KEY (`created_by`)
    REFERENCES `sanusbio`.`users` (`user_id`),
  CONSTRAINT `assignments_ibfk_3`
    FOREIGN KEY (`address_id`)
    REFERENCES `sanusbio`.`address` (`address_id`),
  CONSTRAINT `assignments_ibfk_4`
    FOREIGN KEY (`ferret_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`estrus_&_mating_summary`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`estrus_&_mating_summary` (
  `estrus_&_mating_summary_id` INT NOT NULL,
  `mating_restriction` VARCHAR(45) NULL DEFAULT NULL,
  `unconfirmed_estrus` DATE NULL DEFAULT NULL,
  `confirmed_estrus_start` DATE NULL DEFAULT NULL,
  `days_in_estrus` VARCHAR(45) NULL DEFAULT NULL,
  `estimated_mate_date` DATE NULL DEFAULT NULL,
  `male_cage_mates` VARCHAR(45) NULL DEFAULT NULL,
  `flag_cage_mates` ENUM('0', '1') NULL DEFAULT NULL,
  `last_mating_date` DATE NULL DEFAULT NULL,
  `mating_history` VARCHAR(500) NULL DEFAULT NULL,
  `male_female_conflict` ENUM('0', '1') NULL DEFAULT NULL,
  `created` DATE NULL DEFAULT NULL,
  `created_by` VARCHAR(45) NULL DEFAULT NULL,
  `modified` DATE NULL DEFAULT NULL,
  `Ferret_QR005_id` INT NOT NULL,
  PRIMARY KEY (`estrus_&_mating_summary_id`),
  INDEX `fk_estrus_&_mating_summary_ferret_qr0051_idx` (`Ferret_QR005_id` ASC) VISIBLE,
  CONSTRAINT `fk_estrus_summary_ferret`
    FOREIGN KEY (`Ferret_QR005_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`ferret_location_history`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`ferret_location_history` (
  `location_event_id` INT NOT NULL AUTO_INCREMENT,
  `move_in` DATE NULL DEFAULT NULL,
  `move_out` DATE NULL DEFAULT NULL,
  `ferret_id` INT NOT NULL,
  `address_id` INT NOT NULL,
  `active_ferret_id` INT GENERATED ALWAYS AS ((case when (`move_out` is null) then `ferret_id` else NULL end)) STORED,
  PRIMARY KEY (`location_event_id`),
  UNIQUE INDEX `uq_active_location` (`active_ferret_id` ASC) VISIBLE,
  INDEX `fk_location_ferret` (`ferret_id` ASC) VISIBLE,
  INDEX `fk_location_address` (`address_id` ASC) VISIBLE,
  CONSTRAINT `fk_location_address`
    FOREIGN KEY (`address_id`)
    REFERENCES `sanusbio`.`address` (`address_id`),
  CONSTRAINT `fk_location_ferret`
    FOREIGN KEY (`ferret_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`health_event`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`health_event` (
  `health_event_id` INT NOT NULL AUTO_INCREMENT,
  `ferret_id` INT NOT NULL,
  `event_type` ENUM('weight', 'bath', 'nail_trim') NOT NULL,
  `weight` DECIMAL(6,2) NULL DEFAULT NULL,
  `event_date` DATE NULL DEFAULT NULL,
  `notes` VARCHAR(255) NULL DEFAULT NULL,
  `recorded_by` VARCHAR(45) NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`health_event_id`),
  INDEX `fk_health_ferret` (`ferret_id` ASC) VISIBLE,
  CONSTRAINT `fk_health_ferret`
    FOREIGN KEY (`ferret_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`litter_log`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`litter_log` (
  `litter_log_id` INT NOT NULL AUTO_INCREMENT,
  `litter_id` VARCHAR(45) NULL DEFAULT NULL,
  `litter_date` DATE NULL DEFAULT NULL,
  `from_recent_mating` ENUM('1', '0') NULL DEFAULT NULL,
  `kit_count` INT NULL DEFAULT NULL,
  `stillborn` INT NULL DEFAULT NULL,
  `infant_deaths` INT NULL DEFAULT NULL,
  `surviving_litter_count` INT NULL DEFAULT NULL,
  `kits_transferred_in` INT NULL DEFAULT NULL,
  `kits_transferred_out` INT NULL DEFAULT NULL,
  `transfer_date` DATE NULL DEFAULT NULL,
  `total_litter_size` INT NULL DEFAULT NULL,
  `functioning_nipples` INT NULL DEFAULT NULL,
  `nipple_kit_count` INT NULL DEFAULT NULL,
  `last_weight_grams` INT NULL DEFAULT NULL,
  `previous_weight_grams` INT NULL DEFAULT NULL,
  `last_weigh_date` DATE NULL DEFAULT NULL,
  `previous_weigh_date` DATE NULL DEFAULT NULL,
  `growth_rate_g_per_week` DECIMAL(6,2) GENERATED ALWAYS AS ((case when (`previous_weigh_date` is null) then NULL when ((to_days(`last_weigh_date`) - to_days(`previous_weigh_date`)) <= 0) then NULL else (((`last_weight_grams` - `previous_weight_grams`) / (to_days(`last_weigh_date`) - to_days(`previous_weigh_date`))) * 7) end)) STORED,
  `recent_nest_count` INT NULL DEFAULT NULL,
  `jill_removed_from_litter_date` DATE NULL DEFAULT NULL,
  `need_ids` INT NULL DEFAULT NULL,
  `anomalies_and_notes` VARCHAR(500) NULL DEFAULT NULL,
  `event_history` VARCHAR(1000) NULL DEFAULT NULL,
  `start_kit_on_feed_(21_days)` DATE NULL DEFAULT NULL,
  `dark_cycle_date_(4mo)` DATE NULL DEFAULT NULL,
  `event_summary` VARCHAR(500) NULL DEFAULT NULL,
  `transfer_notes` VARCHAR(500) NULL DEFAULT NULL,
  `transfer_jill_source` VARCHAR(45) NULL DEFAULT NULL,
  `transfer_jill_destination` VARCHAR(45) NULL DEFAULT NULL,
  `report_event` VARCHAR(45) NULL DEFAULT NULL,
  `create_individuals` ENUM('y', 'n') NULL DEFAULT NULL,
  `collect_litter_weight` VARCHAR(45) NULL DEFAULT NULL,
  `support_feeding` VARCHAR(45) NULL DEFAULT NULL,
  `support_feed_type` VARCHAR(45) NULL DEFAULT NULL,
  `today_feed_count` INT NULL DEFAULT NULL,
  `syringe_feeding_log` VARCHAR(1000) NULL DEFAULT NULL,
  `individuals_created` INT NULL DEFAULT NULL,
  `summary_jill` VARCHAR(255) NULL DEFAULT NULL,
  `father` VARCHAR(50) NULL DEFAULT NULL,
  `mother` VARCHAR(50) NULL DEFAULT NULL,
  `created` DATE NULL DEFAULT NULL,
  `created_by` VARCHAR(100) NULL DEFAULT NULL,
  `nest_litter_changed` DATE NULL DEFAULT NULL,
  `change_nest_litter_box` ENUM('0', '1') NULL DEFAULT NULL,
  `nest_box_change_log` VARCHAR(1000) NULL DEFAULT NULL,
  `Ferret_QR005_id` INT NOT NULL,
  PRIMARY KEY (`litter_log_id`),
  INDEX `fk_litter_log_ferret_qr0051_idx` (`Ferret_QR005_id` ASC) VISIBLE,
  CONSTRAINT `fk_litter_ferret`
    FOREIGN KEY (`Ferret_QR005_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`push_subscriptions`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`push_subscriptions` (
  `subscription_id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `subscription_data` TEXT NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`subscription_id`),
  UNIQUE INDEX `unique_user_subscription` (`user_id` ASC) VISIBLE,
  CONSTRAINT `push_subscriptions_ibfk_1`
    FOREIGN KEY (`user_id`)
    REFERENCES `sanusbio`.`users` (`user_id`)
    ON DELETE CASCADE)
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`rfid_assignment`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`rfid_assignment` (
  `rfid_assignment_id` INT NOT NULL AUTO_INCREMENT,
  `rfid` VARCHAR(45) NOT NULL,
  `ferret_id` INT NOT NULL,
  `assigned_date` DATE NOT NULL,
  `unassigned_date` DATE NULL DEFAULT NULL,
  `reason` VARCHAR(45) NULL DEFAULT NULL,
  `notes` VARCHAR(255) NULL DEFAULT NULL,
  PRIMARY KEY (`rfid_assignment_id`),
  INDEX `fk_rfid_ferret` (`ferret_id` ASC) VISIBLE,
  CONSTRAINT `fk_rfid_ferret`
    FOREIGN KEY (`ferret_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------
-- Table `sanusbio`.`vaccination_event`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `sanusbio`.`vaccination_event` (
  `vaccination_event_id` INT NOT NULL AUTO_INCREMENT,
  `ferret_id` INT NOT NULL,
  `vaccine_type` ENUM('rabies', 'distemper', 'other') NOT NULL,
  `vaccination_date` DATE NOT NULL,
  `expiration_date` DATE NULL DEFAULT NULL,
  `notes` VARCHAR(255) NULL DEFAULT NULL,
  `recorded_by` VARCHAR(45) NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`vaccination_event_id`),
  INDEX `fk_vaccine_ferret` (`ferret_id` ASC) VISIBLE,
  CONSTRAINT `fk_vaccine_ferret`
    FOREIGN KEY (`ferret_id`)
    REFERENCES `sanusbio`.`ferret_qr005` (`Ferret_QR005_id`))
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci;


SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;
