import type { Metadata } from "next";
import { JetBrains_Mono, Open_Sans } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

const openSans = Open_Sans({ variable: "--font-open-sans", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AWS Local Console",
  description: "Web console for AWS services running on Floci",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The bootstrap script sets the theme class on <html> before hydration, so its attributes may differ from the server's.
    <html lang="en" className={`${openSans.variable} ${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
