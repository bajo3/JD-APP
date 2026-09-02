CREATE TABLE `customer_account` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_algorithm` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`name` text NOT NULL,
	`phone_normalized` text,
	`lead_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customer_account_email` ON `customer_account` (`email`);--> statement-breakpoint
CREATE INDEX `idx_customer_account_lead` ON `customer_account` (`lead_id`);--> statement-breakpoint
CREATE TABLE `customer_favorite` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `customer_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customer_favorite` ON `customer_favorite` (`account_id`,`vehicle_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_favorite_account` ON `customer_favorite` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customer_preference` (
	`account_id` text PRIMARY KEY NOT NULL,
	`budget_cents` integer,
	`max_monthly_payment_cents` integer,
	`currency` text DEFAULT 'ARS' NOT NULL,
	`preferred_makes_json` text DEFAULT '[]' NOT NULL,
	`preferred_body_types_json` text DEFAULT '[]' NOT NULL,
	`current_vehicle_json` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `customer_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `customer_saved_search` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`query_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `customer_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customer_saved_search_name` ON `customer_saved_search` (`account_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_customer_saved_search_account` ON `customer_saved_search` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customer_session` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_seen_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `customer_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customer_session_token` ON `customer_session` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_customer_session_account` ON `customer_session` (`account_id`,`expires_at`);