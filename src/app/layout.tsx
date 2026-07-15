import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { auth, signOut } from "../lib/auth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgencyOS",
  description: "Agentic recruiting cockpit",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {session && (
          <nav className="topnav">
            <Link href="/">Queue</Link>
            <Link href="/jobs">Jobs</Link>
            <Link href="/candidates">Candidates</Link>
            <Link href="/clients">Clients</Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button type="submit" className="secondary">Sign out</button>
            </form>
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}
