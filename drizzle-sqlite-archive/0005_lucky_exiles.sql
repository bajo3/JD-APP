DROP INDEX `idx_vehicle_media_order`;--> statement-breakpoint
ALTER TABLE `vehicle_media` ADD `byte_size` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicle_media` ADD `sha256` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicle_media` ADD `status` text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicle_media` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicle_media` ADD `uploaded_by` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicle_media` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicle_media` ADD `archived_at` text;--> statement-breakpoint
UPDATE `vehicle_media`
SET `sha256` = 'legacy:' || `id`,
    `uploaded_by` = 'legacy:migration',
    `updated_at` = `created_at`
WHERE `sha256` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vehicle_media_vehicle_sha256` ON `vehicle_media` (`vehicle_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `idx_vehicle_media_status_order` ON `vehicle_media` (`vehicle_id`,`status`,`sort_order`);
