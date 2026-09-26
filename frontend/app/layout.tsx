import type { Metadata } from "next";
import { JetBrains_Mono, Open_Sans } from "next/font/google";
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
    <html lang="en" className={`${openSans.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        {/* The app shell (top bar, sidebar, global search) is owned by components/layout/app-shell.tsx */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
