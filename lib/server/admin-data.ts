import { createAdminRepository, type D1AdminRepository } from "@/lib/data/admin-repositories";

export type AdminDataAccess = D1AdminRepository;

export function getAdminDataAccess(): AdminDataAccess {
  return createAdminRepository();
}

