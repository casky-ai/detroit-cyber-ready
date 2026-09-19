import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Detroit Cyber Ready",
    template: "%s · Detroit Cyber Ready",
  },
  description: "Know when your city is at risk, before an incident becomes an outage.",
};

export const viewport: Viewport = {
  themeColor: "#12161f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <SiteHeader />
        {children}
        <footer className="mt-auto border-t border-border/60">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>Threat data: CISA KEV, live. City technology inventory: simulated, not a scan.</span>
            <span>Venture 313 AI Buildathon</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
