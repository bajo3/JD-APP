-- Guided appraisal photos occupy one slot per capture type; the database
-- enforces that invariant for every writer.
CREATE UNIQUE INDEX `uq_appraisal_media_capture`
ON `appraisal_media` (`appraisal_id`,`capture_type`);
