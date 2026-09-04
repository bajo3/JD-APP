import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { PwaRuntime } from "./_components/PwaRuntime";
import "./globals.css";

// Todas las superficies leen stock, sesiones o configuración comercial actual.
// Evita que Next ejecute D1 durante el build sin el entorno de producción.
export const dynamic = "force-dynamic";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const metadataBase = new URL(host ? `${protocol}://${host}` : "https://jesusdiazautomotores.com.ar");
  const title = "Jesús Díaz Automotores | Tandil";
  const description = "Usados seleccionados, financiación y atención personalizada en Tandil.";

  return {
    metadataBase,
    title,
    description,
    applicationName: "Jesús Díaz Automotores",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "JD Automotores" },
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      shortcut: "/favicon.svg",
      apple: "/apple-touch-icon.png",
    },
    other: { "theme-color": "#18201f" },
    openGraph: {
      type: "website",
      locale: "es_AR",
      title,
      description,
      siteName: "Jesús Díaz Automotores",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Jesús Díaz Automotores — ¿Qué auto te podés llevar hoy?" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <PwaRuntime />
        {children}
      </body>
    </html>
  );
}
