export function isConfirmedWhatsappNumber(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
}

export function isPromotionCurrent(
  promotion: { status: string; startsAt: string; endsAt: string },
  now: Date,
): boolean {
  const instant = now.getTime();
  return (
    promotion.status === "ACTIVE" &&
    Date.parse(promotion.startsAt) <= instant &&
    Date.parse(promotion.endsAt) > instant
  );
}
