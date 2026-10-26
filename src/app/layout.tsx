import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Bakaal Real Estate", template: "%s · Bakaal Real Estate" },
  description: "Internal staff workspace for Bakaal Real Estate Management.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
