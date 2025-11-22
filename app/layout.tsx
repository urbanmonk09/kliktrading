import type { Metadata } from "next";

import "./globals.css";
import { AuthProvider } from "@/src/context/AuthContext";
import Navbar from "@/components/Navbar";



export const metadata: Metadata = {
  title: "AI Trade Signal Generator",
  description: "AI and Algo based high quality trades ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className=""
      >
        <AuthProvider>
          <Navbar/>
          {children}</AuthProvider>
      </body>
    </html>
  );
}
