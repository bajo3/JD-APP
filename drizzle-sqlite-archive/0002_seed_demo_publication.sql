-- Idempotent DEMO data for preview and the initial demo publication only.
-- Every commercial condition is explicitly marked as fictitious.
INSERT INTO `business_profile` (
  `id`, `name`, `city`, `address`, `phone_national`, `whatsapp_e164`,
  `timezone`, `currency`, `locale`, `stock_freshness_minutes`
) VALUES (
  'business-jda', 'Jesús Díaz Automotores', 'Tandil', 'Piedrabuena esq. Rauch',
  '2494587046', '+5492494587046', 'America/Argentina/Buenos_Aires', 'ARS', 'es-AR', 1440
) ON CONFLICT(`id`) DO NOTHING;
--> statement-breakpoint
INSERT INTO `vehicle` (
  `id`, `slug`, `external_code`, `make`, `model`, `trim`, `year`, `mileage_km`,
  `price_cents`, `currency`, `body_type`, `fuel_type`, `transmission`, `color`,
  `status`, `source`, `last_synced_at`, `published_at`, `updated_at`
) VALUES
  ('veh-tcross-2022', 'volkswagen-t-cross-comfortline-2022', 'DEMO-001', 'Volkswagen', 'T-Cross', 'Comfortline', 2022, 46500, 3280000000, 'ARS', 'SUV', 'Nafta', 'Automática', 'Gris', 'AVAILABLE', 'DEMO_SEED', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('veh-cronos-2023', 'fiat-cronos-drive-2023', 'DEMO-002', 'Fiat', 'Cronos', 'Drive 1.3', 2023, 28100, 2490000000, 'ARS', 'Sedán', 'Nafta', 'Manual', 'Blanco', 'AVAILABLE', 'DEMO_SEED', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('veh-tracker-2021', 'chevrolet-tracker-ltz-2021', 'DEMO-003', 'Chevrolet', 'Tracker', 'LTZ', 2021, 52900, 2970000000, 'ARS', 'SUV', 'Nafta', 'Automática', 'Azul', 'AVAILABLE', 'DEMO_SEED', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(`id`) DO UPDATE SET
  `price_cents` = excluded.`price_cents`,
  `status` = 'AVAILABLE',
  `source` = 'DEMO_SEED',
  `last_synced_at` = excluded.`last_synced_at`,
  `published_at` = excluded.`published_at`,
  `updated_at` = excluded.`updated_at`;
--> statement-breakpoint
INSERT INTO `vehicle_price_history` (
  `id`, `vehicle_id`, `price_cents`, `currency`, `valid_from`, `changed_by`, `change_reason`
) VALUES
  ('price-veh-tcross-2022-demo', 'veh-tcross-2022', 3280000000, 'ARS', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'DEMO_SEED', 'DEMO_INITIAL_PRICE'),
  ('price-veh-cronos-2023-demo', 'veh-cronos-2023', 2490000000, 'ARS', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'DEMO_SEED', 'DEMO_INITIAL_PRICE'),
  ('price-veh-tracker-2021-demo', 'veh-tracker-2021', 2970000000, 'ARS', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'DEMO_SEED', 'DEMO_INITIAL_PRICE')
ON CONFLICT(`id`) DO NOTHING;
--> statement-breakpoint
INSERT INTO `finance_plan_version` (
  `id`, `version`, `name`, `provider`, `status`, `currency`, `pricing_kind`,
  `monthly_rate_bps`, `max_finance_ratio_bps`, `minimum_down_payment_ratio_bps`,
  `allowed_vehicle_types_json`, `max_vehicle_age_years`,
  `comfortable_payment_margin_bps`, `is_demo`, `disclaimer`, `valid_from`,
  `valid_until`, `published_at`, `updated_at`
) VALUES (
  'finance-plan-demo-preview', 'DEMO-PREVIEW-V1',
  'DEMO — Plan ilustrativo de previsualización', 'DEMO_NO_COMERCIAL', 'PUBLISHED',
  'ARS', 'french', 250, 7000, 2500, '["car","suv","pickup"]', 10, 1000, 1,
  'TARIFARIO DEMO: valores ficticios para previsualización. No constituye una oferta, aprobación ni condición comercial real.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
) ON CONFLICT(`id`) DO UPDATE SET
  `status` = 'PUBLISHED',
  `provider` = 'DEMO_NO_COMERCIAL',
  `is_demo` = 1,
  `disclaimer` = excluded.`disclaimer`,
  `valid_from` = excluded.`valid_from`,
  `valid_until` = excluded.`valid_until`,
  `published_at` = excluded.`published_at`,
  `updated_at` = excluded.`updated_at`;
--> statement-breakpoint
INSERT INTO `finance_plan_tier` (
  `id`, `finance_plan_version_id`, `term_months`, `min_amount_cents`,
  `max_amount_cents`, `sort_order`
) VALUES
  ('finance-plan-demo-tier-12', 'finance-plan-demo-preview', 12, 300000000, 2200000000, 0),
  ('finance-plan-demo-tier-18', 'finance-plan-demo-preview', 18, 300000000, 2200000000, 1),
  ('finance-plan-demo-tier-24', 'finance-plan-demo-preview', 24, 300000000, 2200000000, 2)
ON CONFLICT(`id`) DO UPDATE SET
  `min_amount_cents` = excluded.`min_amount_cents`,
  `max_amount_cents` = excluded.`max_amount_cents`,
  `sort_order` = excluded.`sort_order`;
--> statement-breakpoint
INSERT INTO `promotion` (
  `id`, `slug`, `public_code`, `title`, `description`, `type`, `status`,
  `discount_cents`, `trade_in_bonus_cents`, `stackable`,
  `normal_conditions_snapshot_json`, `starts_at`, `ends_at`, `published_at`, `updated_at`
) VALUES (
  'promo-demo-dia', 'oferta-demo-del-dia', 'JD-DEMO',
  'DEMO — Oferta JD de previsualización',
  'Ejemplo ficticio para validar la experiencia. No constituye una oferta comercial real.',
  'PRICE_DISCOUNT', 'ACTIVE', 100000000, 0, 0,
  '{"vehicleId":"veh-tcross-2022","normalPriceCents":3280000000,"demo":true}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+23 hours'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
) ON CONFLICT(`id`) DO UPDATE SET
  `title` = excluded.`title`,
  `description` = excluded.`description`,
  `status` = 'ACTIVE',
  `normal_conditions_snapshot_json` = excluded.`normal_conditions_snapshot_json`,
  `starts_at` = excluded.`starts_at`,
  `ends_at` = excluded.`ends_at`,
  `published_at` = excluded.`published_at`,
  `updated_at` = excluded.`updated_at`;
--> statement-breakpoint
INSERT INTO `promotion_vehicle` (`promotion_id`, `vehicle_id`, `is_primary`)
VALUES ('promo-demo-dia', 'veh-tcross-2022', 1)
ON CONFLICT(`promotion_id`, `vehicle_id`) DO UPDATE SET
  `is_primary` = excluded.`is_primary`;
--> statement-breakpoint
PRAGMA optimize;
