import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { LogoutButton } from "../_components/AccountActions";
import {
  PanelAuthenticationRequired,
  PanelAccessError,
  requirePanelUser,
} from "@/lib/server/panel-auth";
import { PanelProtectedState } from "./protected-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PanelLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function PanelLayout({ children }: PanelLayoutProps) {
  let user;
  try {
    user = await requirePanelUser("/panel");
  } catch (error) {
    if (error instanceof PanelAuthenticationRequired) {
      redirect(`/cuenta/ingresar?volver=${encodeURIComponent(error.returnTo)}`);
    }
    if (error instanceof PanelAccessError) {
      return <PanelProtectedState code={error.code} />;
    }
    throw error;
  }

  return (
    <div className="min-h-screen bg-[#f4f2ec] text-[#18201f]">
      <header className="flex min-h-16 items-center gap-4 border-b border-black/10 bg-white px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-lg bg-[#e86636] text-sm font-black text-white"
          >
            JD
          </span>
          <div>
            <strong className="block text-sm">Jesús Díaz Automotores</strong>
            <span className="block text-[10px] uppercase tracking-[0.16em] text-[#66716e]">
              Panel interno
            </span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="hidden text-[#66716e] sm:inline">
            {user.displayName}
          </span>
          <LogoutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
