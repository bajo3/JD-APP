CREATE TABLE IF NOT EXISTS `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`previous_version` integer,
	`next_version` integer,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_admin_audit_resource_occurred` ON `admin_audit_log` (`resource_type`,`resource_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_admin_audit_actor_occurred` ON `admin_audit_log` (`actor_user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `admin_idempotency` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_admin_idempotency_scope_key` ON `admin_idempotency` (`scope`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_admin_idempotency_resource` ON `admin_idempotency` (`resource_type`,`resource_id`);--> statement-breakpoint
ALTER TABLE `finance_plan_version` ADD `lock_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_finance_plan_status_updated` ON `finance_plan_version` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_promotion_status_updated` ON `promotion` (`status`,`updated_at`);--> statement-breakpoint
PRAGMA optimize;
