import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/app/_components/PublicShell";
import { findPublicPassportReview } from "@/lib/server/passport-review";
import { PassportReviewForm } from "./PassportReviewForm";

export const metadata: Metadata = {
  title: "Confirmá tu búsqueda | Jesús Díaz Automotores",
  robots: { index: false, follow: false },
};

export default async function PassportReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const review = await findPublicPassportReview(token);
  if (!review) notFound();
  return (
    <PublicShell>
      <main id="contenido" className="public-page form-page">
        <div className="form-intro">
          <p className="eyebrow">TU BÚSQUEDA</p>
          <h1>Revisá lo que vamos a buscar</h1>
          <p>Corregí lo que haga falta. No buscamos a tu nombre hasta que confirmes estos datos.</p>
        </div>
        <PassportReviewForm token={token} initial={review} />
      </main>
    </PublicShell>
  );
}
