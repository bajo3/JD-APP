CREATE TABLE `buyer_passport` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`conversation_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`budget_cents` integer,
	`down_payment_cents` integer,
	`max_monthly_payment_cents` integer,
	`currency` text DEFAULT 'ARS' NOT NULL,
	`desired_makes_json` text DEFAULT '[]' NOT NULL,
	`desired_models_json` text DEFAULT '[]' NOT NULL,
	`accepted_types_json` text DEFAULT '[]' NOT NULL,
	`min_year` integer,
	`max_mileage_km` integer,
	`primary_use` text,
	`needs_financing` integer,
	`trade_in_appraisal_id` text,
	`trade_in_description` text,
	`urgency_days` integer,
	`locality` text,
	`max_distance_km` integer,
	`mandatory_conditions_json` text DEFAULT '[]' NOT NULL,
	`negotiable_conditions_json` text DEFAULT '[]' NOT NULL,
	`confirmed_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `inbox_conversation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`trade_in_appraisal_id`) REFERENCES `appraisal`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_buyer_passport_lead` ON `buyer_passport` (`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_buyer_passport_status_updated` ON `buyer_passport` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `demand_match` (
	`id` text PRIMARY KEY NOT NULL,
	`demand_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`score_bps` integer NOT NULL,
	`breakdown_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`notified_to` text,
	`notified_at` text,
	`responded_at` text,
	`visited_at` text,
	`purchased_at` text,
	`discarded_reason` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`demand_id`) REFERENCES `demand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_demand_match_demand_vehicle` ON `demand_match` (`demand_id`,`vehicle_id`);--> statement-breakpoint
CREATE INDEX `idx_demand_match_status_score` ON `demand_match` (`status`,`score_bps`);--> statement-breakpoint
CREATE INDEX `idx_demand_match_vehicle` ON `demand_match` (`vehicle_id`);--> statement-breakpoint
CREATE TABLE `demand` (
	`id` text PRIMARY KEY NOT NULL,
	`public_code` text NOT NULL,
	`passport_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`criteria_json` text NOT NULL,
	`valid_until` text NOT NULL,
	`assigned_to` text,
	`closed_reason` text,
	`closed_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`passport_id`) REFERENCES `buyer_passport`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_demand_public_code` ON `demand` (`public_code`);--> statement-breakpoint
CREATE INDEX `idx_demand_status_valid` ON `demand` (`status`,`valid_until`);--> statement-breakpoint
CREATE INDEX `idx_demand_lead` ON `demand` (`lead_id`);