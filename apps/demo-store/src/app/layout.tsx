import type { Metadata } from "next";
import { FlagsmithProvider } from "@/components/FlagsmithProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ToggleWars Demo Store — Flagsmith DevBar",
  description: "Self-hosted Flagsmith local QA, chaos testing, and Bayesian experimentation demo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <FlagsmithProvider>{children}</FlagsmithProvider>
      </body>
    </html>
  );
}
