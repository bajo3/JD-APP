-- Consignación virtual: unidades ofrecidas por particulares para que JDA
-- las venda en consignación. La autorización de carga es un token privado
-- de 256 bits (sólo se persiste su SHA-256); las fotos viven en storage
-- privado con lifecycle PENDING -> READY | FAILED -> ARCHIVED para poder
-- reanudar o compensar caídas entre D1 y R2.
CREATE TABLE `consignment_media` (
	`id` text PRIMARY KEY NOT NULL,
	`consignment_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`capture_type` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`request_hash` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`uploaded_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`consignment_id`) REFERENCES `consignment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_consignment_media_r2_key` ON `consignment_media` (`r2_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_consignment_media_capture` ON `consignment_media` (`consignment_id`,`capture_type`) WHERE status <> 'ARCHIVED';--> statement-breakpoint
CREATE INDEX `idx_consignment_media_order` ON `consignment_media` (`consignment_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_consignment_media_status` ON `consignment_media` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `consignment` (
	`id` text PRIMARY KEY NOT NULL,
	`public_code` text NOT NULL,
	`idempotency_key` text,
	`command_hash` text NOT NULL,
	`upload_token_hash` text NOT NULL,
	`lead_id` text,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`trim` text,
	`year` integer NOT NULL,
	`mileage_km` integer NOT NULL,
	`declared_condition` text NOT NULL,
	`asking_price_cents` integer,
	`owner_notes` text,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`reviewed_by` text,
	`review_notes` text,
	`decided_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `lead`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_consignment_public_code` ON `consignment` (`public_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_consignment_idempotency_key` ON `consignment` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_consignment_status_updated` ON `consignment` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_consignment_lead` ON `consignment` (`lead_id`);