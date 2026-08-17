import { cache } from "react";
import type { BusinessProfileRow } from "@/db/schema";
import type { CurrentPromotion, StockVehicle } from "@/lib/data/repositories";
import { getDataAccess, sourceMeta, type DataSource } from "./data-access";
import { businessProfileDto, promotionDto, vehicleDto } from "./dto";

const DISPLAY_TIME_ZONE = "America/Argentina/Buenos_Aires";
const DEFAULT_STOCK_FRESHNESS_MINUTES = 1_440;
const VEHICLE_TONES = ["vehicle-blue", "vehicle-silver", "vehicle-graphite"] as const;

export type PublicVehicleView = Readonly<{
  id: string;
  slug: string;
  type: string;
  name: string;
  year: string;
  km: string;
  price: string;
  priceCents: number;
  tone: (typeof VEHICLE_TONES)[number];
  availability: "AVAILABLE_TODAY" | "CHECK_AVAILABILITY";
  availabilityLabel: string;
  updatedAt: string;
  updatedLabel: string;
  demo: boolean;
  image: Readonly<{
    url: string;
    alt: string;
    width: number;
    height: number;
  }> | null;
}>;

export type PublicPromotionView = Readonly<{
  id: string;
  title: string;
  description: string;
  type: string;
  benefitLabel: string;
  normalPrice: string | null;
  effectivePrice: string | null;
  endsAt: string;
  validityLabel: string;
  vehicle: PublicVehicleView | null;
  demo: boolean;
}>;

export type PublicProfileView = Readonly<{
  name: string;
  city: string;
  address: string;
  phoneNational: string;
  whatsappE164: string | null;
}>;

type PublicBase = Readonly<{
  source: DataSource;
  demo: boolean;
  sourceLabel: string;
  profile: PublicProfileView | null;
}>;

export async function getPublicHomeData(): Promise<
  PublicBase & {
    vehicles: readonly PublicVehicleView[];
    promotion: PublicPromotionView | null;
  }
> {
  const access = getDataAccess();
  const now = new Date();
  const [rows, profileRow, promotionRow] = await Promise.all([
    access.stock.listAvailable(),
    access.businessProfile.get(),
    access.promotions.findCurrent(now),
  ]);
  const context = createContext(access.source, profileRow, now);
  const vehicles = rows.map((row) => publicVehicle(row, context));
  const promotion = publicPromotion(promotionRow, vehicles, now);
  const demo = vehicles.some((vehicle) => vehicle.demo) || promotion?.demo === true;
  return {
    ...baseData(access.source, profileRow, demo),
    vehicles,
    promotion,
  };
}

export async function getPublicStockData(): Promise<
  PublicBase & { vehicles: readonly PublicVehicleView[] }
> {
  const access = getDataAccess();
  const now = new Date();
  const [rows, profileRow] = await Promise.all([
    access.stock.listAvailable(),
    access.businessProfile.get(),
  ]);
  const context = createContext(access.source, profileRow, now);
  return {
    ...baseData(access.source, profileRow, rows.some((row) => row.source === "DEMO_SEED")),
    vehicles: rows.map((row) => publicVehicle(row, context)),
  };
}

export const getPublicVehicleDetail = cache(async (slug: string) => {
  const access = getDataAccess();
  const now = new Date();
  const [row, profileRow] = await Promise.all([
    access.stock.findBySlug(slug),
    access.businessProfile.get(),
  ]);
  const context = createContext(access.source, profileRow, now);
  return {
    ...baseData(access.source, profileRow, row?.source === "DEMO_SEED"),
    vehicle: row ? publicVehicle(row, context) : null,
  } satisfies PublicBase & { vehicle: PublicVehicleView | null };
});

export async function getPublicOfferData(): Promise<
  PublicBase & { promotion: PublicPromotionView | null }
> {
  const access = getDataAccess();
  const now = new Date();
  const [rows, profileRow, promotionRow] = await Promise.all([
    access.stock.listAvailable(),
    access.businessProfile.get(),
    access.promotions.findCurrent(now),
  ]);
  const context = createContext(access.source, profileRow, now);
  const vehicles = rows.map((row) => publicVehicle(row, context));
  const promotion = publicPromotion(promotionRow, vehicles, now);
  return {
    ...baseData(access.source, profileRow, promotion?.demo === true),
    promotion,
  };
}

function createContext(
  source: DataSource,
  profileRow: BusinessProfileRow | null,
  now: Date,
) {
  return {
    source,
    stockFreshnessMinutes:
      profileRow?.stockFreshnessMinutes ?? DEFAULT_STOCK_FRESHNESS_MINUTES,
    now,
  };
}

function publicVehicle(
  row: StockVehicle,
  context: ReturnType<typeof createContext>,
): PublicVehicleView {
  const dto = vehicleDto(row, context.stockFreshnessMinutes, context.now);
  const demo = dto.demo;
  const availability: PublicVehicleView["availability"] =
    dto.availability === "AVAILABLE_TODAY"
      ? "AVAILABLE_TODAY"
      : "CHECK_AVAILABILITY";
  const firstImage = dto.media.find((media) => Boolean(media.url));
  return {
    id: dto.id,
    slug: dto.slug,
    type: dto.bodyType.toUpperCase(),
    name: [dto.make, dto.model, dto.trim].filter(Boolean).join(" "),
    year: String(dto.year),
    km: `${new Intl.NumberFormat("es-AR").format(dto.mileageKm)} km`,
    price: formatArs(dto.price.cents),
    priceCents: dto.price.cents,
    tone: toneFor(dto.id),
    availability,
    availabilityLabel:
      dto.availability === "AVAILABLE_TODAY"
        ? "Disponible según última actualización"
        : "Disponibilidad a confirmar",
    updatedAt: dto.lastSyncedAt ?? dto.updatedAt,
    updatedLabel: formatUpdated(dto.lastSyncedAt ?? dto.updatedAt),
    demo,
    image: firstImage?.url
      ? {
          url: firstImage.url,
          alt: firstImage.alt || `${[dto.make, dto.model, dto.trim].filter(Boolean).join(" ")} ${dto.year}`,
          width: firstImage.width ?? 1_200,
          height: firstImage.height ?? 800,
        }
      : null,
  };
}

function publicPromotion(
  row: CurrentPromotion | null,
  vehicles: readonly PublicVehicleView[],
  now: Date,
): PublicPromotionView | null {
  if (!row) return null;
  const dto = promotionDto(row, now);
  const vehicle = vehicles.find((item) => dto.vehicleIds.includes(item.id)) ?? null;
  const discount = Math.max(0, dto.discountCents);
  const normalPriceCents = vehicle?.priceCents ?? null;
  const effectivePriceCents =
    normalPriceCents === null ? null : Math.max(0, normalPriceCents - discount);
  return {
    id: dto.id,
    title: dto.title,
    description: dto.description,
    type: dto.type,
    benefitLabel: promotionBenefitLabel(dto),
    normalPrice: normalPriceCents === null ? null : formatArs(normalPriceCents),
    effectivePrice:
      effectivePriceCents === null ? null : formatArs(effectivePriceCents),
    endsAt: dto.endsAt,
    validityLabel: `Vigente hasta ${formatDateTime(dto.endsAt)}`,
    vehicle,
    demo: dto.demo,
  };
}

function baseData(
  source: DataSource,
  profileRow: BusinessProfileRow | null,
  demoOverride = false,
): PublicBase {
  const meta = sourceMeta(source);
  const demo = meta.demo || demoOverride;
  const profile = profileRow ? businessProfileDto(profileRow) : null;
  return {
    source,
    demo,
    sourceLabel: demo
      ? "Datos de demostración"
      : "Datos publicados por Jesús Díaz Automotores",
    profile: profile
      ? {
          name: profile.name,
          city: profile.city,
          address: profile.address,
          phoneNational: profile.phoneNational,
          whatsappE164: profile.whatsappE164,
        }
      : null,
  };
}

function promotionBenefitLabel(dto: ReturnType<typeof promotionDto>): string {
  if (dto.type === "TRADE_IN_BONUS" && dto.tradeInBonusCents > 0) {
    return `Bonificación adicional por usado de ${formatArs(dto.tradeInBonusCents)}`;
  }
  if (dto.type === "FINANCING_SPECIAL") {
    return "Condición especial de financiación; consultá requisitos y aprobación";
  }
  if (dto.discountCents > 0) {
    return `Descuento vigente de ${formatArs(dto.discountCents)}`;
  }
  return "Condición promocional sujeta a disponibilidad y requisitos";
}

function toneFor(id: string): PublicVehicleView["tone"] {
  const hash = [...id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return VEHICLE_TONES[hash % VEHICLE_TONES.length];
}

function formatArs(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatUpdated(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return "Actualización no informada";
  return `Actualizado ${formatDateTime(value)}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
