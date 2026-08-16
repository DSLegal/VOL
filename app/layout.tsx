import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VOL NQ/MNQ Risk Planner",
  description: "Plan NQ or MNQ financial exposure from a trader-defined entry and invalidation, then compare that distance with historical NQ adverse movement.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "VOL NQ/MNQ Risk Planner",
    description: "Risk-first NQ and MNQ planning with neutral historical adverse-movement references.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "VOL NQ/MNQ Risk Planner" }],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
