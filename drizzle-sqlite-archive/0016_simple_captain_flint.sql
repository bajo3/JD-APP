ALTER TABLE `appraisal_rule_set` ADD `lock_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `appraisal_rule_set` ADD `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;