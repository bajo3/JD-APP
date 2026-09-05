CREATE TABLE `channel_account` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'ZERNIO' NOT NULL,
	`platform` text NOT NULL,
	`external_account_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`default_assignee` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_channel_account_provider_external` ON `channel_account` (`provider`,`external_account_id`);--> statement-breakpoint
CREATE INDEX `idx_channel_account_platform_status` ON `channel_account` (`platform`,`status`);--> statement-breakpoint
CREATE TABLE `channel_webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'ZERNIO' NOT NULL,
	`external_event_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'RECEIVED' NOT NULL,
	`failure_reason` text,
	`received_at` text NOT NULL,
	`processed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_channel_webhook_event_provider_external` ON `channel_webhook_event` (`provider`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `idx_channel_webhook_event_status_received` ON `channel_webhook_event` (`status`,`received_at`);--> statement-breakpoint
CREATE TABLE `inbox_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'ZERNIO' NOT NULL,
	`external_conversation_id` text NOT NULL,
	`channel_account_id` text NOT NULL,
	`platform` text NOT NULL,
	`participant_external_id` text NOT NULL,
	`participant_phone_normalized` text,
	`participant_display_name` text,
	`lead_id` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`handling` text DEFAULT 'HUMAN' NOT NULL,
	`assigned_to` text,
	`last_inbound_at` text,
	`last_outbound_at` text,
	`first_response_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`channel_account_id`) REFERENCES `channel_account`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_inbox_conversation_provider_external` ON `inbox_conversation` (`provider`,`external_conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_inbox_conversation_status_inbound` ON `inbox_conversation` (`status`,`last_inbound_at`);--> statement-breakpoint
CREATE INDEX `idx_inbox_conversation_assigned_inbound` ON `inbox_conversation` (`assigned_to`,`last_inbound_at`);--> statement-breakpoint
CREATE INDEX `idx_inbox_conversation_lead` ON `inbox_conversation` (`lead_id`);--> statement-breakpoint
CREATE TABLE `inbox_message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`provider` text DEFAULT 'ZERNIO' NOT NULL,
	`external_message_id` text NOT NULL,
	`platform_message_id` text,
	`direction` text NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text,
	`text` text,
	`attachments_json` text DEFAULT '[]' NOT NULL,
	`simulation_id` text,
	`appraisal_id` text,
	`delivery_status` text,
	`delivery_error` text,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `inbox_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`simulation_id`) REFERENCES `simulation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`appraisal_id`) REFERENCES `appraisal`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_inbox_message_provider_external` ON `inbox_message` (`provider`,`external_message_id`);--> statement-breakpoint
CREATE INDEX `idx_inbox_message_conversation_occurred` ON `inbox_message` (`conversation_id`,`occurred_at`);