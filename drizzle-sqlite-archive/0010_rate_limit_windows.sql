CREATE TABLE `rate_limit_window` (
	`key` text PRIMARY KEY NOT NULL,
	`resource` text NOT NULL,
	`expires_at` text NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limit_expiry` ON `rate_limit_window` (`expires_at`);