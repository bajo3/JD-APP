CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"previous_version" integer,
	"next_version" integer,
	"summary_json" text DEFAULT '{}' NOT NULL,
	"occurred_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_idempotency" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appraisal_media" (
	"id" text PRIMARY KEY NOT NULL,
	"appraisal_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"capture_type" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appraisal_rule_set" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"rules_json" text NOT NULL,
	"valid_from" text,
	"valid_until" text,
	"published_by" text,
	"lock_version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appraisal" (
	"id" text PRIMARY KEY NOT NULL,
	"public_code" text NOT NULL,
	"idempotency_key" text,
	"lead_id" text,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"trim" text,
	"year" integer NOT NULL,
	"mileage_km" integer NOT NULL,
	"declared_condition" text NOT NULL,
	"documentation_status" text,
	"has_lien" boolean DEFAULT false NOT NULL,
	"repair_notes" text,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"certainty_level" text DEFAULT 'T0' NOT NULL,
	"low_cents" bigint,
	"base_cents" bigint,
	"high_cents" bigint,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"rule_set_id" text,
	"reviewed_by" text,
	"review_notes" text,
	"valid_until" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"address" text NOT NULL,
	"phone_national" text NOT NULL,
	"whatsapp_e164" text,
	"timezone" text NOT NULL,
	"currency" text NOT NULL,
	"locale" text NOT NULL,
	"map_url" text,
	"hours_json" text,
	"social_links_json" text,
	"stock_freshness_minutes" integer DEFAULT 1440 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer_passport" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"conversation_id" text,
	"review_token_hash" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"budget_cents" bigint,
	"down_payment_cents" bigint,
	"max_monthly_payment_cents" bigint,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"desired_makes_json" text DEFAULT '[]' NOT NULL,
	"desired_models_json" text DEFAULT '[]' NOT NULL,
	"accepted_types_json" text DEFAULT '[]' NOT NULL,
	"min_year" integer,
	"max_mileage_km" integer,
	"primary_use" text,
	"needs_financing" boolean,
	"trade_in_appraisal_id" text,
	"trade_in_description" text,
	"urgency_days" integer,
	"locality" text,
	"max_distance_km" integer,
	"mandatory_conditions_json" text DEFAULT '[]' NOT NULL,
	"negotiable_conditions_json" text DEFAULT '[]' NOT NULL,
	"confirmed_at" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_account" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'ZERNIO' NOT NULL,
	"platform" text NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"default_assignee" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'ZERNIO' NOT NULL,
	"external_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload_json" text NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"failure_reason" text,
	"received_at" text NOT NULL,
	"processed_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"granted_at" text NOT NULL,
	"revoked_at" text,
	"evidence_json" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consignment_media" (
	"id" text PRIMARY KEY NOT NULL,
	"consignment_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"capture_type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"request_hash" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"uploaded_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consignment" (
	"id" text PRIMARY KEY NOT NULL,
	"public_code" text NOT NULL,
	"idempotency_key" text,
	"command_hash" text NOT NULL,
	"upload_token_hash" text NOT NULL,
	"lead_id" text,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"trim" text,
	"year" integer NOT NULL,
	"mileage_km" integer NOT NULL,
	"declared_condition" text NOT NULL,
	"asking_price_cents" bigint,
	"owner_notes" text,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"reviewed_by" text,
	"review_notes" text,
	"decided_at" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_account" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_algorithm" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"password_iterations" integer NOT NULL,
	"name" text NOT NULL,
	"phone_normalized" text,
	"lead_id" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" text,
	"last_login_at" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_favorite" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_preference" (
	"account_id" text PRIMARY KEY NOT NULL,
	"budget_cents" bigint,
	"max_monthly_payment_cents" bigint,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"preferred_makes_json" text DEFAULT '[]' NOT NULL,
	"preferred_body_types_json" text DEFAULT '[]' NOT NULL,
	"current_vehicle_json" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_saved_search" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"query_json" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_session" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"last_seen_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_match" (
	"id" text PRIMARY KEY NOT NULL,
	"demand_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"score_bps" integer NOT NULL,
	"breakdown_json" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"notified_to" text,
	"notified_at" text,
	"responded_at" text,
	"visited_at" text,
	"purchased_at" text,
	"discarded_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand" (
	"id" text PRIMARY KEY NOT NULL,
	"public_code" text NOT NULL,
	"passport_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"criteria_json" text NOT NULL,
	"valid_until" text NOT NULL,
	"assigned_to" text,
	"closed_reason" text,
	"closed_at" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_stock_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"payload_hash" text,
	"last_seen_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_plan_tier" (
	"id" text PRIMARY KEY NOT NULL,
	"finance_plan_version_id" text NOT NULL,
	"term_months" integer NOT NULL,
	"min_amount_cents" bigint NOT NULL,
	"max_amount_cents" bigint NOT NULL,
	"installment_coefficient_ppm" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_plan_version" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"pricing_kind" text NOT NULL,
	"monthly_rate_bps" integer,
	"installment_coefficient_ppm" integer,
	"max_finance_ratio_bps" integer NOT NULL,
	"minimum_down_payment_ratio_bps" integer NOT NULL,
	"allowed_vehicle_types_json" text NOT NULL,
	"max_vehicle_age_years" integer NOT NULL,
	"requires_promotion_id" text,
	"comfortable_payment_margin_bps" integer DEFAULT 1000 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"disclaimer" text NOT NULL,
	"valid_from" text NOT NULL,
	"valid_until" text NOT NULL,
	"published_at" text,
	"lock_version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'ZERNIO' NOT NULL,
	"external_conversation_id" text NOT NULL,
	"channel_account_id" text NOT NULL,
	"platform" text NOT NULL,
	"participant_external_id" text NOT NULL,
	"participant_phone_normalized" text,
	"participant_display_name" text,
	"lead_id" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"handling" text DEFAULT 'HUMAN' NOT NULL,
	"assigned_to" text,
	"follow_up_at" text,
	"follow_up_note" text,
	"last_inbound_at" text,
	"last_outbound_at" text,
	"first_response_at" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_message" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"conversation_id" text NOT NULL,
	"provider" text DEFAULT 'ZERNIO' NOT NULL,
	"external_message_id" text NOT NULL,
	"platform_message_id" text,
	"direction" text NOT NULL,
	"author_type" text NOT NULL,
	"author_id" text,
	"text" text,
	"attachments_json" text DEFAULT '[]' NOT NULL,
	"simulation_id" text,
	"appraisal_id" text,
	"delivery_status" text,
	"delivery_error" text,
	"occurred_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_event" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"occurred_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_interest" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"kind" text NOT NULL,
	"vehicle_id" text,
	"appraisal_id" text,
	"simulation_id" text,
	"promotion_id" text,
	"context_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text,
	"create_request_hash" text,
	"name" text NOT NULL,
	"phone_normalized" text NOT NULL,
	"email" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"assigned_to" text,
	"lost_reason" text,
	"last_contacted_at" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_vehicle" (
	"promotion_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "promotion_vehicle_promotion_id_vehicle_id_pk" PRIMARY KEY("promotion_id","vehicle_id")
);
--> statement-breakpoint
CREATE TABLE "promotion" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"public_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"trade_in_bonus_cents" bigint DEFAULT 0 NOT NULL,
	"finance_plan_version_id" text,
	"stackable" boolean DEFAULT false NOT NULL,
	"normal_conditions_snapshot_json" text NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"published_at" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_window" (
	"key" text PRIMARY KEY NOT NULL,
	"resource" text NOT NULL,
	"expires_at" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation" (
	"id" text PRIMARY KEY NOT NULL,
	"public_code" text NOT NULL,
	"idempotency_key" text,
	"lead_id" text,
	"vehicle_id" text,
	"appraisal_id" text,
	"promotion_id" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"classification" text NOT NULL,
	"certainty_level" text NOT NULL,
	"vehicle_price_cents" bigint NOT NULL,
	"effective_price_cents" bigint NOT NULL,
	"appraisal_applied_cents" bigint DEFAULT 0 NOT NULL,
	"trade_in_bonus_cents" bigint DEFAULT 0 NOT NULL,
	"cash_cents" bigint DEFAULT 0 NOT NULL,
	"finance_principal_cents" bigint DEFAULT 0 NOT NULL,
	"term_months" integer,
	"installment_cents" bigint,
	"total_cost_cents" bigint,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"engine_version" text NOT NULL,
	"rule_version" text NOT NULL,
	"finance_plan_version" text,
	"input_snapshot_json" text NOT NULL,
	"result_snapshot_json" text NOT NULL,
	"disclaimer_snapshot" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"records_seen" integer DEFAULT 0 NOT NULL,
	"records_changed" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_summary" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_media" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"public_url" text,
	"content_type" text NOT NULL,
	"alt_text" text NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"sha256" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"uploaded_by" text DEFAULT 'legacy' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"archived_at" text
);
--> statement-breakpoint
CREATE TABLE "vehicle_price_history" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"valid_from" text NOT NULL,
	"valid_until" text,
	"changed_by" text NOT NULL,
	"change_reason" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"external_code" text,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"trim" text NOT NULL,
	"year" integer NOT NULL,
	"mileage_km" integer NOT NULL,
	"price_cents" bigint NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"price_valid_until" text,
	"body_type" text NOT NULL,
	"fuel_type" text NOT NULL,
	"transmission" text NOT NULL,
	"color" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"last_synced_at" text,
	"published_at" text,
	"internal_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_request" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"conversation_id" text,
	"vehicle_id" text,
	"requested_at" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"assigned_to" text,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appraisal_media" ADD CONSTRAINT "appraisal_media_appraisal_id_appraisal_id_fk" FOREIGN KEY ("appraisal_id") REFERENCES "public"."appraisal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_rule_set_id_appraisal_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."appraisal_rule_set"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_passport" ADD CONSTRAINT "buyer_passport_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_passport" ADD CONSTRAINT "buyer_passport_conversation_id_inbox_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_passport" ADD CONSTRAINT "buyer_passport_trade_in_appraisal_id_appraisal_id_fk" FOREIGN KEY ("trade_in_appraisal_id") REFERENCES "public"."appraisal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignment_media" ADD CONSTRAINT "consignment_media_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignment" ADD CONSTRAINT "consignment_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account" ADD CONSTRAINT "customer_account_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_favorite" ADD CONSTRAINT "customer_favorite_account_id_customer_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_favorite" ADD CONSTRAINT "customer_favorite_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preference" ADD CONSTRAINT "customer_preference_account_id_customer_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_saved_search" ADD CONSTRAINT "customer_saved_search_account_id_customer_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_session" ADD CONSTRAINT "customer_session_account_id_customer_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_match" ADD CONSTRAINT "demand_match_demand_id_demand_id_fk" FOREIGN KEY ("demand_id") REFERENCES "public"."demand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_match" ADD CONSTRAINT "demand_match_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand" ADD CONSTRAINT "demand_passport_id_buyer_passport_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."buyer_passport"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand" ADD CONSTRAINT "demand_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_stock_mapping" ADD CONSTRAINT "external_stock_mapping_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_plan_tier" ADD CONSTRAINT "finance_plan_tier_finance_plan_version_id_finance_plan_version_id_fk" FOREIGN KEY ("finance_plan_version_id") REFERENCES "public"."finance_plan_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversation" ADD CONSTRAINT "inbox_conversation_channel_account_id_channel_account_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversation" ADD CONSTRAINT "inbox_conversation_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_conversation_id_inbox_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_simulation_id_simulation_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."simulation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_appraisal_id_appraisal_id_fk" FOREIGN KEY ("appraisal_id") REFERENCES "public"."appraisal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_event" ADD CONSTRAINT "lead_event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interest" ADD CONSTRAINT "lead_interest_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interest" ADD CONSTRAINT "lead_interest_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interest" ADD CONSTRAINT "lead_interest_appraisal_id_appraisal_id_fk" FOREIGN KEY ("appraisal_id") REFERENCES "public"."appraisal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interest" ADD CONSTRAINT "lead_interest_simulation_id_simulation_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."simulation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interest" ADD CONSTRAINT "lead_interest_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotion"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_vehicle" ADD CONSTRAINT "promotion_vehicle_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_vehicle" ADD CONSTRAINT "promotion_vehicle_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_finance_plan_version_id_finance_plan_version_id_fk" FOREIGN KEY ("finance_plan_version_id") REFERENCES "public"."finance_plan_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation" ADD CONSTRAINT "simulation_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation" ADD CONSTRAINT "simulation_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation" ADD CONSTRAINT "simulation_appraisal_id_appraisal_id_fk" FOREIGN KEY ("appraisal_id") REFERENCES "public"."appraisal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation" ADD CONSTRAINT "simulation_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotion"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_media" ADD CONSTRAINT "vehicle_media_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_price_history" ADD CONSTRAINT "vehicle_price_history_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_request" ADD CONSTRAINT "visit_request_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_request" ADD CONSTRAINT "visit_request_conversation_id_inbox_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_request" ADD CONSTRAINT "visit_request_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_audit_resource_occurred" ON "admin_audit_log" USING btree ("resource_type","resource_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_actor_occurred" ON "admin_audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_admin_idempotency_scope_key" ON "admin_idempotency" USING btree ("scope","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_admin_idempotency_resource" ON "admin_idempotency" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_appraisal_media_r2_key" ON "appraisal_media" USING btree ("r2_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_appraisal_media_capture" ON "appraisal_media" USING btree ("appraisal_id","capture_type");--> statement-breakpoint
CREATE INDEX "idx_appraisal_media_order" ON "appraisal_media" USING btree ("appraisal_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_appraisal_rule_set_version" ON "appraisal_rule_set" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_appraisal_public_code" ON "appraisal" USING btree ("public_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_appraisal_idempotency_key" ON "appraisal" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_appraisal_status_updated" ON "appraisal" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_appraisal_lead" ON "appraisal" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_buyer_passport_lead" ON "buyer_passport" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_buyer_passport_review_token" ON "buyer_passport" USING btree ("review_token_hash");--> statement-breakpoint
CREATE INDEX "idx_buyer_passport_status_updated" ON "buyer_passport" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channel_account_provider_external" ON "channel_account" USING btree ("provider","external_account_id");--> statement-breakpoint
CREATE INDEX "idx_channel_account_platform_status" ON "channel_account" USING btree ("platform","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channel_webhook_event_provider_external" ON "channel_webhook_event" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "idx_channel_webhook_event_status_received" ON "channel_webhook_event" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "idx_consent_lead_purpose" ON "consent" USING btree ("lead_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_consignment_media_r2_key" ON "consignment_media" USING btree ("r2_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_consignment_media_capture" ON "consignment_media" USING btree ("consignment_id","capture_type") WHERE status <> 'ARCHIVED';--> statement-breakpoint
CREATE INDEX "idx_consignment_media_order" ON "consignment_media" USING btree ("consignment_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_consignment_media_status" ON "consignment_media" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_consignment_public_code" ON "consignment" USING btree ("public_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_consignment_idempotency_key" ON "consignment" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_consignment_status_updated" ON "consignment" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_consignment_lead" ON "consignment" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_account_email" ON "customer_account" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_customer_account_lead" ON "customer_account" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_favorite" ON "customer_favorite" USING btree ("account_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "idx_customer_favorite_account" ON "customer_favorite" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_saved_search_name" ON "customer_saved_search" USING btree ("account_id","name");--> statement-breakpoint
CREATE INDEX "idx_customer_saved_search_account" ON "customer_saved_search" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_session_token" ON "customer_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_customer_session_account" ON "customer_session" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_demand_match_demand_vehicle" ON "demand_match" USING btree ("demand_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "idx_demand_match_status_score" ON "demand_match" USING btree ("status","score_bps");--> statement-breakpoint
CREATE INDEX "idx_demand_match_vehicle" ON "demand_match" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_demand_public_code" ON "demand" USING btree ("public_code");--> statement-breakpoint
CREATE INDEX "idx_demand_status_valid" ON "demand" USING btree ("status","valid_until");--> statement-breakpoint
CREATE INDEX "idx_demand_lead" ON "demand" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_external_stock_provider_id" ON "external_stock_mapping" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_external_stock_vehicle_provider" ON "external_stock_mapping" USING btree ("vehicle_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_finance_plan_tier_band" ON "finance_plan_tier" USING btree ("finance_plan_version_id","term_months","min_amount_cents");--> statement-breakpoint
CREATE INDEX "idx_finance_plan_tier_plan_order" ON "finance_plan_tier" USING btree ("finance_plan_version_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_finance_plan_version" ON "finance_plan_version" USING btree ("version");--> statement-breakpoint
CREATE INDEX "idx_finance_plan_status_window" ON "finance_plan_version" USING btree ("status","valid_from","valid_until");--> statement-breakpoint
CREATE INDEX "idx_finance_plan_status_updated" ON "finance_plan_version" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inbox_conversation_provider_external" ON "inbox_conversation" USING btree ("provider","external_conversation_id");--> statement-breakpoint
CREATE INDEX "idx_inbox_conversation_status_inbound" ON "inbox_conversation" USING btree ("status","last_inbound_at");--> statement-breakpoint
CREATE INDEX "idx_inbox_conversation_assigned_inbound" ON "inbox_conversation" USING btree ("assigned_to","last_inbound_at");--> statement-breakpoint
CREATE INDEX "idx_inbox_conversation_status_follow_up" ON "inbox_conversation" USING btree ("status","follow_up_at");--> statement-breakpoint
CREATE INDEX "idx_inbox_conversation_lead" ON "inbox_conversation" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inbox_message_provider_external" ON "inbox_message" USING btree ("provider","external_message_id");--> statement-breakpoint
CREATE INDEX "idx_inbox_message_conversation_occurred" ON "inbox_message" USING btree ("conversation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_lead_event_lead_occurred" ON "lead_event" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lead_interest_lead_kind_simulation" ON "lead_interest" USING btree ("lead_id","kind","simulation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lead_interest_simulation" ON "lead_interest" USING btree ("simulation_id");--> statement-breakpoint
CREATE INDEX "idx_lead_interest_lead_created" ON "lead_interest" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lead_idempotency_key" ON "lead" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_lead_status_updated" ON "lead" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_lead_phone" ON "lead" USING btree ("phone_normalized");--> statement-breakpoint
CREATE INDEX "idx_promotion_vehicle_vehicle" ON "promotion_vehicle" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_promotion_slug" ON "promotion" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_promotion_public_code" ON "promotion" USING btree ("public_code");--> statement-breakpoint
CREATE INDEX "idx_promotion_status_window" ON "promotion" USING btree ("status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "idx_promotion_status_updated" ON "promotion" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_rate_limit_expiry" ON "rate_limit_window" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_simulation_public_code" ON "simulation" USING btree ("public_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_simulation_idempotency_key" ON "simulation" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_simulation_lead_created" ON "simulation" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_simulation_vehicle_created" ON "simulation" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_stock_sync_provider_started" ON "stock_sync_run" USING btree ("provider","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vehicle_media_r2_key" ON "vehicle_media" USING btree ("r2_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vehicle_media_vehicle_sha256" ON "vehicle_media" USING btree ("vehicle_id","sha256");--> statement-breakpoint
CREATE INDEX "idx_vehicle_media_status_order" ON "vehicle_media" USING btree ("vehicle_id","status","sort_order");--> statement-breakpoint
CREATE INDEX "idx_vehicle_price_history_vehicle" ON "vehicle_price_history" USING btree ("vehicle_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vehicle_slug" ON "vehicle" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vehicle_external_code" ON "vehicle" USING btree ("external_code");--> statement-breakpoint
CREATE INDEX "idx_vehicle_status_updated" ON "vehicle" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_vehicle_make_model" ON "vehicle" USING btree ("make","model");--> statement-breakpoint
CREATE INDEX "idx_visit_request_status_requested" ON "visit_request" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "idx_visit_request_lead" ON "visit_request" USING btree ("lead_id");