import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import "katex/dist/katex.min.css";
import "./globals.css";
import { themeBootScript } from "@/modules/editor/theme";

export const metadata: Metadata = {
  title: "Technical Infographic",
  description: "AI-first technical visual editor",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Stamps the saved theme onto <html> before the first paint. Without it
          the page renders light and then flips to dark, which reads worse than
          either theme on its own.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
