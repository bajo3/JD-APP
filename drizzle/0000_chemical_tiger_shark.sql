CREATE TABLE `appraisal_media` (
	`id` text PRIMARY KEY NOT NULL,
	`appraisal_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`capture_type` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`uploaded_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`appraisal_id`) REFERENCES `appraisal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_appraisal_media_r2_key` ON `appraisal_media` (`r2_key`);--> statement-breakpoint
CREATE INDEX `idx_appraisal_media_order` ON `appraisal_media` (`appraisal_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `appraisal_rule_set` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`rules_json` text NOT NULL,
	`valid_from` text,
	`valid_until` text,
	`published_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_appraisal_rule_set_version` ON `appraisal_rule_set` (`version`);--> statement-breakpoint
CREATE TABLE `appraisal` (
	`id` text PRIMARY KEY NOT NULL,
	`public_code` text NOT NULL,
	`idempotency_key` text,
	`lead_id` text,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`trim` text,
	`year` integer NOT NULL,
	`mileage_km` integer NOT NULL,
	`declared_condition` text NOT NULL,
	`documentation_status` text,
	`has_lien` integer DEFAULT false NOT NULL,
	`repair_notes` text,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`certainty_level` text DEFAULT 'T0' NOT NULL,
	`low_cents` integer,
	`base_cents` integer,
	`high_cents` integer,
	`currency` text DEFAULT 'ARS' NOT NULL,
	`rule_set_id` text,
	`reviewed_by` text,
	`review_notes` text,
	`valid_until` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rule_set_id`) REFERENCES `appraisal_rule_set`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_appraisal_public_code` ON `appraisal` (`public_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_appraisal_idempotency_key` ON `appraisal` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_appraisal_status_updated` ON `appraisal` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_appraisal_lead` ON `appraisal` (`lead_id`);--> statement-breakpoint
CREATE TABLE `business_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`city` text NOT NULL,
	`address` text NOT NULL,
	`phone_national` text NOT NULL,
	`whatsapp_e164` text,
	`timezone` text NOT NULL,
	`currency` text NOT NULL,
	`locale` text NOT NULL,
	`map_url` text,
	`hours_json` text,
	`social_links_json` text,
	`stock_freshness_minutes` integer DEFAULT 1440 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `consent` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`channel` text NOT NULL,
	`purpose` text NOT NULL,
	`granted_at` text NOT NULL,
	`revoked_at` text,
	`evidence_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_consent_lead_purpose` ON `consent` (`lead_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `external_stock_mapping` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`payload_hash` text,
	`last_seen_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_external_stock_provider_id` ON `external_stock_mapping` (`provider`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_external_stock_vehicle_provider` ON `external_stock_mapping` (`vehicle_id`,`provider`);--> statement-breakpoint
CREATE TABLE `lead_event` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_lead_event_lead_occurred` ON `lead_event` (`lead_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `lead_interest` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`kind` text NOT NULL,
	`vehicle_id` text,
	`appraisal_id` text,
	`simulation_id` text,
	`promotion_id` text,
	`context_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`appraisal_id`) REFERENCES `appraisal`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`simulation_id`) REFERENCES `simulation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promotion_id`) REFERENCES `promotion`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_lead_interest_lead_created` ON `lead_interest` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lead` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text,
	`name` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`email` text,
	`source` text NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`assigned_to` text,
	`lost_reason` text,
	`last_contacted_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lead_idempotency_key` ON `lead` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_lead_status_updated` ON `lead` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_lead_phone` ON `lead` (`phone_normalized`);--> statement-breakpoint
CREATE TABLE `promotion_vehicle` (
	`promotion_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`promotion_id`, `vehicle_id`),
	FOREIGN KEY (`promotion_id`) REFERENCES `promotion`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_promotion_vehicle_vehicle` ON `promotion_vehicle` (`vehicle_id`);--> statement-breakpoint
CREATE TABLE `promotion` (
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
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_promotion_slug` ON `promotion` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_promotion_public_code` ON `promotion` (`public_code`);--> statement-breakpoint
CREATE INDEX `idx_promotion_status_window` ON `promotion` (`status`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `simulation` (
	`id` text PRIMARY KEY NOT NULL,
	`public_code` text NOT NULL,
	`idempotency_key` text,
	`lead_id` text,
	`vehicle_id` text,
	`appraisal_id` text,
	`promotion_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`classification` text NOT NULL,
	`certainty_level` text NOT NULL,
	`vehicle_price_cents` integer NOT NULL,
	`effective_price_cents` integer NOT NULL,
	`appraisal_applied_cents` integer DEFAULT 0 NOT NULL,
	`trade_in_bonus_cents` integer DEFAULT 0 NOT NULL,
	`cash_cents` integer DEFAULT 0 NOT NULL,
	`finance_principal_cents` integer DEFAULT 0 NOT NULL,
	`term_months` integer,
	`installment_cents` integer,
	`total_cost_cents` integer,
	`currency` text DEFAULT 'ARS' NOT NULL,
	`engine_version` text NOT NULL,
	`rule_version` text NOT NULL,
	`finance_plan_version` text,
	`input_snapshot_json` text NOT NULL,
	`result_snapshot_json` text NOT NULL,
	`disclaimer_snapshot` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`appraisal_id`) REFERENCES `appraisal`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promotion_id`) REFERENCES `promotion`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_simulation_public_code` ON `simulation` (`public_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_simulation_idempotency_key` ON `simulation` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_simulation_lead_created` ON `simulation` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_simulation_vehicle_created` ON `simulation` (`vehicle_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stock_sync_run` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`records_seen` integer DEFAULT 0 NOT NULL,
	`records_changed` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stock_sync_provider_started` ON `stock_sync_run` (`provider`,`started_at`);--> statement-breakpoint
CREATE TABLE `vehicle_media` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`public_url` text,
	`content_type` text NOT NULL,
	`alt_text` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vehicle_media_r2_key` ON `vehicle_media` (`r2_key`);--> statement-breakpoint
CREATE INDEX `idx_vehicle_media_order` ON `vehicle_media` (`vehicle_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `vehicle_price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text,
	`changed_by` text NOT NULL,
	`change_reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_vehicle_price_history_vehicle` ON `vehicle_price_history` (`vehicle_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `vehicle` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`external_code` text,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`trim` text NOT NULL,
	`year` integer NOT NULL,
	`mileage_km` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'ARS' NOT NULL,
	`price_valid_until` text,
	`body_type` text NOT NULL,
	`fuel_type` text NOT NULL,
	`transmission` text NOT NULL,
	`color` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`last_synced_at` text,
	`published_at` text,
	`internal_notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vehicle_slug` ON `vehicle` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vehicle_external_code` ON `vehicle` (`external_code`);--> statement-breakpoint
CREATE INDEX `idx_vehicle_status_updated` ON `vehicle` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_vehicle_make_model` ON `vehicle` (`make`,`model`);--> statement-breakpoint
PRAGMA optimize;
