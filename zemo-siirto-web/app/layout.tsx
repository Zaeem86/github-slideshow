import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ZEMO | Auton siirto Suomessa", template: "%s · ZEMO" },
  description: "Nopea ja luotettava auton siirto koko Suomessa. Tarkastettu kuljettaja ajaa autosi perille."
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fi"><body>{children}</body></html>;
}
