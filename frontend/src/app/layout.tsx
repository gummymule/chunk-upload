import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Chunk Upload",
  description: "Unggah banyak file sekaligus dengan chunked upload",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
