import {
  listAdminAppraisals,
  listAdminLeads,
  listAdminPromotions,
  listAdminStock,
  listFinanceVersions,
  getAdminAppraisal,
  getAdminOverview,
  type AdminAppraisalRecord,
} from "@/lib/admin";
import { buildSellerLeadDetailDto } from "@/lib/crm/index.mjs";
import { D1AppraisalMediaRepository } from "@/lib/data/appraisal-media-repository";
import { D1LeadContextReadRepository } from "@/lib/data/lead-context-read-repository";
import { adminDependencies } from "./admin-adapter";
import { requirePanelUser } from "./panel-auth";
import { notFound } from "next/navigation";

export type AdminLead = {
  id: string;
  name: string;
  interest: string;
  status: string;
  createdAt: string;
  version: number;
};

export type AdminVehicle = {
  id: string;
  name: string;
  year: number;
  price: string;
  status: string;
  version: number;
};

export type AdminAppraisal = {
  id: string;
  name: string;
  vehicle: string;
  status: string;
  createdAt: string;
  version: number;
};

export type AdminOffer = {
  id: string;
  title: string;
  vehicle: string;
  status: string;
  startsAt: string;
  endsAt: string;
  version: number;
};

export type AdminFinancePlan = {
  id: string;
  name: string;
  provider: string;
  status: string;
  version: number;
  isDemo: 0 | 1;
};

export type SellerLeadEvent = Readonly<{
  id: string;
  type: string;
  occurredAt: string;
  actorType: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type SellerLeadOperation = Readonly<{
  simulationCode: string;
  vehicle: Readonly<{
    id: string;
    slug: string;
    label: string;
    make: string;
    model: string;
    trim: string | null;
    year: number;
  }>;
  status: string;
  classification: string;
  certaintyLevel: string;
  amounts: Readonly<{
    currency: string;
    listedPriceCents: number;
    effectivePriceCents: number;
    appraisalAppliedCents: number;
    tradeInBonusCents: number;
    cashCents: number;
    financePrincipalCents: number;
    installmentCents: number | null;
    totalCostCents: number | null;
  }>;
  termMonths: number | null;
  createdAt: string;
  expiresAt: string;
  validity: "ACTIVE" | "EXPIRED";
  disclaimer: string;
}>;

export type SellerLeadDetailDto = Readonly<{
  schemaVersion: string;
  id: string;
  name: string;
  phone: string;
  source: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  operation: SellerLeadOperation | null;
  events: readonly SellerLeadEvent[];
  generatedAt: string;
}>;

const sellerLeadDetail = buildSellerLeadDetailDto as unknown as (input: {
  lead: unknown;
  simulation: unknown;
  vehicle: unknown;
  events: readonly unknown[];
  now: Date;
}) => SellerLeadDetailDto;

type LeadDetailRuntime = Readonly<{
  repository?: D1LeadContextReadRepository;
  now?: Date;
  authorize?: (returnTo: string) => Promise<unknown>;
}>;

export async function getAdminLeadDetailData(
  id: string,
  runtime: LeadDetailRuntime = {},
): Promise<{ lead: SellerLeadDetailDto }> {
  const safeId = id.trim();
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(safeId)) notFound();
  await (runtime.authorize ?? requirePanelUser)(`/panel/leads/${safeId}`);
  const record = await (runtime.repository ?? new D1LeadContextReadRepository()).findById(safeId);
  if (!record) notFound();
  const lead = sellerLeadDetail({
    lead: record.lead,
    simulation: record.simulation,
    vehicle: record.vehicle,
    events: record.events,
    now: runtime.now ?? new Date(),
  });
  return { lead };
}

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export type AdminAppraisalPhoto = Readonly<{
  id: string;
  captureType: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  sortOrder: number;
  uploadedAt: string;
  url: string;
}>;

type AppraisalDetailRuntime = Readonly<{
  mediaRepository?: D1AppraisalMediaRepository;
}>;

export async function getAdminAppraisalDetailData(
  id: string,
  runtime: AppraisalDetailRuntime = {},
): Promise<{ appraisal: AdminAppraisalRecord; photos: readonly AdminAppraisalPhoto[] }> {
  const safeId = id.trim();
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(safeId)) notFound();
  const user = await requirePanelUser(`/panel/tasaciones/${safeId}`);
  const dependencies = adminDependencies({
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
  });
  let appraisal: AdminAppraisalRecord;
  try {
    appraisal = await getAdminAppraisal(dependencies, safeId);
  } catch {
    notFound();
  }
  const media = await (runtime.mediaRepository ?? new D1AppraisalMediaRepository()).listByAppraisal(
    safeId,
  );
  return {
    appraisal,
    photos: media.map((photo): AdminAppraisalPhoto => ({
      id: photo.id,
      captureType: photo.captureType,
      contentType: photo.contentType,
      byteSize: photo.byteSize,
      sha256: photo.sha256,
      sortOrder: photo.sortOrder,
      uploadedAt: photo.uploadedAt,
      url: `/api/v1/admin/appraisals/${safeId}/photos/${photo.id}`,
    })),
  };
}

export async function getAdminPanelData() {
  const user = await requirePanelUser("/panel");
  const dependencies = adminDependencies({
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
  });
  const [overview, leadRows, vehicleRows, appraisalRows, promotionRows, financeRows] = await Promise.all([
    getAdminOverview(dependencies),
    listAdminLeads(dependencies, { limit: 100 }),
    listAdminStock(dependencies, { limit: 100 }),
    listAdminAppraisals(dependencies, { limit: 100 }),
    listAdminPromotions(dependencies, { limit: 100 }),
    listFinanceVersions(dependencies),
  ]);
  return {
    overview,
    leads: leadRows.map((lead): AdminLead => ({
      id: lead.id,
      name: lead.name,
      interest: lead.simulationCode
        ? `${lead.vehicleLabel ?? lead.vehicleId ?? "Unidad"} · ${lead.simulationCode}`
        : "Consulta general",
      status: lead.status,
      createdAt: lead.createdAt,
      version: lead.version,
    })),
    vehicles: vehicleRows.map((vehicle): AdminVehicle => ({
      id: vehicle.id,
      name: `${vehicle.make} ${vehicle.model} ${vehicle.trim}`,
      year: vehicle.year,
      price: ars.format(vehicle.priceCents / 100),
      status: vehicle.status,
      version: vehicle.version,
    })),
    appraisals: appraisalRows.map((appraisal): AdminAppraisal => ({
      id: appraisal.id,
      name: appraisal.leadId ?? "Sin lead asociado",
      vehicle: appraisal.vehicleDescription,
      status: appraisal.status,
      createdAt: appraisal.createdAt,
      version: appraisal.version,
    })),
    offers: promotionRows.map((promotion): AdminOffer => ({
      id: promotion.id,
      title: promotion.title,
      vehicle: promotion.vehicleIds.join(", "),
      status: promotion.status,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      version: promotion.version,
    })),
    financePlans: financeRows.map((plan): AdminFinancePlan => ({
      id: plan.id,
      name: plan.name,
      provider: plan.provider,
      status: plan.status,
      version: plan.lockVersion,
      isDemo: plan.isDemo ? 1 : 0,
    })),
  };
}
