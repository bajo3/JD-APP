import {
  listAdminAppraisals,
  listAdminLeads,
  listAdminPromotions,
  listAdminStock,
  listFinanceVersions,
  getAdminOverview,
} from "@/lib/admin";
import { adminDependencies } from "./admin-adapter";
import { requirePanelUser } from "./panel-auth";

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

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

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
      interest: lead.simulationCode ?? lead.vehicleId ?? "Consulta general",
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
