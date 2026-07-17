import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "lusora",
  description: "Automated multi-channel video production",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
