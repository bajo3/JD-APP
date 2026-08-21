import type { Metadata } from "next";
import { PublicShell } from "../_components/PublicShell";
import { ConsignmentForm } from "../_components/ConsignmentForm";

export const metadata: Metadata = {
  title: "Consigná tu auto | Jesús Díaz Automotores",
  description:
    "Ofrecé tu unidad en consignación: subí las cinco fotos guiadas y un vendedor la revisa antes de publicarla.",
  robots: { index: false, follow: false },
};

export default function ConsignmentPage() {
  return (
    <PublicShell>
      <main id="contenido" className="public-page form-page">
        <div className="form-intro">
          <p className="eyebrow">CONSIGNACIÓN VIRTUAL</p>
          <h1>Ofrecé tu unidad con nosotros</h1>
          <p>
            Subí las cinco fotos guiadas de tu auto y lo ofrecemos por vos. Seguí usándolo
            hasta la venta: la publicación y las condiciones se acuerdan con un vendedor, sin
            compromiso.
          </p>
          <p className="finder-disclaimer">
            Capacidad opcional en revisión con Jesús Díaz Automotores: la comisión, el
            contrato y el retiro de la unidad se definen antes de habilitarla para todos.
          </p>
        </div>
        <ConsignmentForm />
      </main>
    </PublicShell>
  );
}
