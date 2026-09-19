import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

// Public Sans is the typeface of the U.S. Web Design System: the type of
// accountable government, which is the pillar this product answers to.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "Detroit Cyber Ready",
    template: "%s | Detroit Cyber Ready",
  },
  description: "Know when your city is at risk, before an incident becomes an outage.",
};

export const viewport: Viewport = {
  themeColor: "#0f1b1d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} h-full antialiased dark`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <SiteHeader />
        {children}
        <footer className="mt-auto border-t border-border/60">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>Threat data comes live from the CISA Known Exploited Vulnerabilities catalog. The city technology inventory is simulated; nothing here scans real systems.</span>
            <span className="shrink-0">Built for the Venture 313 AI Buildathon</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
