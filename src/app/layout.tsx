import type { Metadata } from "next";
import "./globals.css";
import "./giflab.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://giflab.local"),
  title: "GifLab Studio",
  description:
    "A local GIF archive studio with search, collections, color editing, and export previews.",
  manifest: "/media/assets/favicon/site.webmanifest",
  icons: {
    icon: [
      { url: "/media/assets/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/media/assets/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/media/assets/favicon/favicon.ico",
    apple: { url: "/media/assets/favicon/apple-touch-icon.png", sizes: "180x180" },
    other: [{ rel: "mask-icon", url: "/media/assets/favicon/safari-pinned-tab.svg", color: "#08c18a" }],
  },
  openGraph: {
    title: "GifLab Studio",
    type: "website",
    url: "https://giflab.local/",
    images: [{ url: "/media/assets/pictures/giflab.gif", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GifLab Studio",
    description:
      "Search and preview color variants across a large local GIF archive.",
    images: ["/media/assets/pictures/giflab-twitter.gif"],
  },
};

export const viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="gif-body">{children}</body>
    </html>
  );
}
