-- SanusBio Migration 18: Backfill surviving_litter_count
-- Run AFTER 17_location_history_and_litter_estimate.sql
-- Safe to re-run
--
-- New litters now get surviving_litter_count (= kit_count - stillborn - infant_deaths)
-- computed automatically at creation/edit time (server.js v1.10.1), so stillborn
-- kits are excluded from "individuals left to create". Backfill existing rows
-- that predate this so the Litters page / Create Ferrets flow is correct for them too.

USE sanusbio;

UPDATE litter_log
SET surviving_litter_count = GREATEST(0, kit_count - COALESCE(stillborn, 0) - COALESCE(infant_deaths, 0))
WHERE kit_count IS NOT NULL
  AND surviving_litter_count IS NULL;