-- El número +5492494587046 fue cargado por 0003 sin evidencia de
-- confirmación de JDA. Se retira del perfil hasta que el negocio confirme el
-- E.164 y la modalidad; sin número configurado, toda superficie enlaza a
-- /contacto (fail-closed). La decisión queda registrada en DECISIONES_JDA.md.
UPDATE `business_profile`
SET
  `whatsapp_e164` = NULL,
  `version` = `version` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE
  `id` = 'business-jda'
  AND `whatsapp_e164` = '+5492494587046';
