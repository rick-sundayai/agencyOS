import type { Metadata } from "next";
import { Schibsted_Grotesk, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { auth, signOut } from "../lib/auth";
import { ThemeToggle, THEME_STORAGE_KEY, DEFAULT_THEME } from "../components/ThemeToggle";
import "./tokens.css";
import "./globals.css";

const display = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AgencyOS",
  description: "Agentic recruiting cockpit",
};

// Applies the persisted theme to <html> before first paint, so there's no
// light→dark flash on load. Single-sourced from ThemeToggle's constants (the
// script string can't import at runtime, so we interpolate at build time).
const noFlashTheme = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');document.documentElement.setAttribute('data-theme',(t==='dark'||t==='light')?t:'${DEFAULT_THEME}');}catch(e){document.documentElement.setAttribute('data-theme','${DEFAULT_THEME}');}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
        {session && (
          <nav className="topnav">
            <Link href="/">Queue</Link>
            <Link href="/jobs">Jobs</Link>
            <Link href="/candidates">Candidates</Link>
            <Link href="/clients">Clients</Link>
            <ThemeToggle />
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
