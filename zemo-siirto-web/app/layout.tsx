import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Zemo Siirto | Car transfer, made simple", template: "%s · Zemo Siirto" },
  description: "Professional car transfers across Finland. Your car is driven by an approved independent driver."
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
