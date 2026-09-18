import type { Metadata } from "next";
import "./globals.css";
import "./accessibility.css";

export const metadata: Metadata = {
  title: "CIE Nexus · Plataforma clínica",
  description: "Evaluación, enseñanza y reevaluación de competencias clínicas ABA.",
  other: { "codex-preview": "development" },
  icons: { icon: "/api/branding/icon", shortcut: "/api/branding/icon", apple: "/api/branding/icon" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className="antialiased">{children}</body></html>;
}
