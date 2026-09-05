-- Align the contextual WhatsApp handoff with the business number supplied for JDA.
UPDATE `business_profile`
SET
  `whatsapp_e164` = '+5492494587046',
  `version` = `version` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE
  `id` = 'business-jda'
  AND `phone_national` = '2494587046'
  AND (`whatsapp_e164` IS NULL OR `whatsapp_e164` = '');
