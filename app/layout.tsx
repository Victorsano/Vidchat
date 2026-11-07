import type { Metadata } from "next";
import "./globals.css";
import "./product.css";
import "./connected.css";
export const metadata: Metadata = {
  title: "Dorcas Match — Your campus. Your people.",
  description:
    "Private, verified student connections. Friends, dating, study, and consensual conversations.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
