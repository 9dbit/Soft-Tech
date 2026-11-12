import type { Metadata } from "next";
import "./globals.css";
import "./light-ui.css";
import "./light-responsive.css";
import "./v4.css";
import "./v4-responsive.css";
import "./v5-desktop.css";
import "./v52-mobile.css";
import "./v57-unified-ui.css";
import "./v58-landscape-games.css";
import "./v61-locked-typography.css";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://xd-play.com";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "XDPLAY | Beyond Play", template: "%s | XDPLAY" },
  description: "Creative worlds. Intelligent technology. Extraordinary experiences. Explore Skygate 5000, UNO LUCK and Mahjong Wild.",
  keywords: ["XDPLAY", "game development studio", "interactive entertainment", "Skygate 5000", "UNO LUCK", "Mahjong Wild"],
  applicationName: "XDPLAY",
  icons: { icon: "/assets/xdplay-icon.png", apple: "/assets/xdplay-icon.png" },
  openGraph: { type: "website", title: "XDPLAY | Beyond Play", description: "Explore original interactive games from XDPLAY.", siteName: "XDPLAY", images: ["/assets/xdplay-social.png"] },
  robots: { index: true, follow: true }
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
