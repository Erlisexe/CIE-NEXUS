import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CIE Nexus · Plataforma clínica",
  description: "Evaluación, enseñanza y reevaluación de competencias clínicas ABA.",
  other: { "codex-preview": "development" },
  icons: { icon: "/api/branding/icon", shortcut: "/api/branding/icon", apple: "/api/branding/icon" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
