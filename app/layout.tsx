import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trial Eligibility Matcher",
  description:
    "Match FHIR patient records against clinical trial eligibility criteria with reasoning and gap analysis. Built with Next.js, TypeScript, and Claude Sonnet 4.6.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
