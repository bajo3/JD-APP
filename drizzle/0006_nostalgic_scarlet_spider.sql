ALTER TABLE `lead` ADD `create_request_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lead_interest_lead_kind_simulation` ON `lead_interest` (`lead_id`,`kind`,`simulation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lead_interest_simulation` ON `lead_interest` (`simulation_id`);