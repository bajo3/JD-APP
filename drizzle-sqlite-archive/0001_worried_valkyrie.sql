CREATE TABLE `finance_plan_tier` (
	`id` text PRIMARY KEY NOT NULL,
	`finance_plan_version_id` text NOT NULL,
	`term_months` integer NOT NULL,
	`min_amount_cents` integer NOT NULL,
	`max_amount_cents` integer NOT NULL,
	`installment_coefficient_ppm` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`finance_plan_version_id`) REFERENCES `finance_plan_version`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_finance_plan_tier_band` ON `finance_plan_tier` (`finance_plan_version_id`,`term_months`,`min_amount_cents`);--> statement-breakpoint
CREATE INDEX `idx_finance_plan_tier_plan_order` ON `finance_plan_tier` (`finance_plan_version_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `finance_plan_version` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`currency` text DEFAULT 'ARS' NOT NULL,
	`pricing_kind` text NOT NULL,
	`monthly_rate_bps` integer,
	`installment_coefficient_ppm` integer,
	`max_finance_ratio_bps` integer NOT NULL,
	`minimum_down_payment_ratio_bps` integer NOT NULL,
	`allowed_vehicle_types_json` text NOT NULL,
	`max_vehicle_age_years` integer NOT NULL,
	`requires_promotion_id` text,
	`comfortable_payment_margin_bps` integer DEFAULT 1000 NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`disclaimer` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`published_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_finance_plan_version` ON `finance_plan_version` (`version`);--> statement-breakpoint
CREATE INDEX `idx_finance_plan_status_window` ON `finance_plan_version` (`status`,`valid_from`,`valid_until`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_promotion` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`public_code` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`trade_in_bonus_cents` integer DEFAULT 0 NOT NULL,
	`finance_plan_version_id` text,
	`stackable` integer DEFAULT false NOT NULL,
	`normal_conditions_snapshot_json` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`published_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`finance_plan_version_id`) REFERENCES `finance_plan_version`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_promotion`("id", "slug", "public_code", "title", "description", "type", "status", "discount_cents", "trade_in_bonus_cents", "finance_plan_version_id", "stackable", "normal_conditions_snapshot_json", "starts_at", "ends_at", "published_at", "version", "created_at", "updated_at") SELECT "id", "slug", "public_code", "title", "description", "type", "status", "discount_cents", "trade_in_bonus_cents", "finance_plan_version_id", "stackable", "normal_conditions_snapshot_json", "starts_at", "ends_at", "published_at", "version", "created_at", "updated_at" FROM `promotion`;--> statement-breakpoint
DROP TABLE `promotion`;--> statement-breakpoint
ALTER TABLE `__new_promotion` RENAME TO `promotion`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_promotion_slug` ON `promotion` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_promotion_public_code` ON `promotion` (`public_code`);--> statement-breakpoint
CREATE INDEX `idx_promotion_status_window` ON `promotion` (`status`,`starts_at`,`ends_at`);--> statement-breakpoint
PRAGMA optimize;
