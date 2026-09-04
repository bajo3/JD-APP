CREATE TABLE `visit_request` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`conversation_id` text,
	`vehicle_id` text,
	`requested_at` text NOT NULL,
	`status` text DEFAULT 'REQUESTED' NOT NULL,
	`assigned_to` text,
	`note` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `inbox_conversation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicle`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_visit_request_status_requested` ON `visit_request` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_visit_request_lead` ON `visit_request` (`lead_id`);--> statement-breakpoint
ALTER TABLE `buyer_passport` ADD `review_token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_buyer_passport_review_token` ON `buyer_passport` (`review_token_hash`);