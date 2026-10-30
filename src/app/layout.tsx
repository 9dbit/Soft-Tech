import type { Metadata } from "next";
import "./globals.css";
import "./light-ui.css";
import "./light-responsive.css";
import "./v4.css";
import "./v4-responsive.css";
import "./v5-desktop.css";
import "./v52-mobile.css";
import "./v57-unified-ui.css";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://soft-tech-web-production.up.railway.app";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "SOFT TECH | Beyond Play", template: "%s | SOFT TECH" },
  description: "Creative worlds. Intelligent technology. Extraordinary experiences. Explore Skygate 5000, UNO LUCK and Mahjong Wild.",
  keywords: ["Soft Tech", "game development studio", "interactive entertainment", "Skygate 5000", "UNO LUCK", "Mahjong Wild"],
  applicationName: "Soft Tech",
  icons: { icon: "/assets/soft-tech-logo.png", apple: "/assets/soft-tech-logo.png" },
  openGraph: { type: "website", title: "SOFT TECH | Beyond Play", description: "Explore original interactive games from Soft Tech.", images: ["/assets/soft-tech-logo.png"] },
  robots: { index: true, follow: true }
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
