ALTER TABLE `inbox_conversation` ADD `follow_up_at` text;--> statement-breakpoint
ALTER TABLE `inbox_conversation` ADD `follow_up_note` text;--> statement-breakpoint
CREATE INDEX `idx_inbox_conversation_status_follow_up` ON `inbox_conversation` (`status`,`follow_up_at`);