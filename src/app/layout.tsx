import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PRISM — AI code review that understands your repository",
    template: "%s · PRISM",
  },
  description:
    "Pull Request Intelligence & Review Mesh. Go beyond the diff: repository-aware context, a multi-agent review mesh, adversarial verification and evidence-backed findings.",
  metadataBase: new URL("https://prism.local"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-graphite-950 text-graphite-100 antialiased">{children}</body>
    </html>
  );
}
