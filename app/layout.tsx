import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Historical Volatility Stop-Loss Lab",
  description: "Explore NQ historical adverse excursion by session, month, ISO week and regime, then translate an independently defined stop to MNQ risk.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "Historical Volatility Stop-Loss Lab",
    description: "Session · Month · Week · Regime",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Historical Volatility Stop-Loss Lab" }],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
