import type { Metadata, Viewport } from "next";
import { Inter, Nunito } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { lightTokens } from "@/design/tokens";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Nurra",
  description: "A gentle daily companion for people who forget their medicines, with updates for the family.",
  applicationName: "Nurra",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: lightTokens.primary,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request: the CSP nonce set by the proxy is different each time, and
  // signed-in pages must never be prerendered or cached.
  await connection();
  return (
    <html lang="en" className={`${inter.variable} ${nunito.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
