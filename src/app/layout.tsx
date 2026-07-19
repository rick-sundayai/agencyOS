import type { Metadata } from "next";
import { Schibsted_Grotesk, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { auth, signOut } from "../lib/auth";
import { listQueue } from "../services/decision-store";
import { listRoster } from "../services/agent-roster";
import { ThemeToggle, THEME_STORAGE_KEY, DEFAULT_THEME } from "../components/ThemeToggle";
import { SidebarNav } from "../components/SidebarNav";
import { AgentRoster } from "../components/AgentRoster";
import { TopBar } from "../components/TopBar";
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
  // Server-rendered seed for the Cockpit nav badge — the count of Decisions in the
  // operator's queue at load. SidebarNav then keeps it live off the Cockpit stream.
  const pendingCount = session ? (await listQueue(session.user.org_id)).length : 0;
  const roster = session ? await listRoster(session.user.org_id) : null;
  const accountName = session?.user.name ?? session?.user.email ?? "Operator";
  const accountInitials = initials(accountName);

  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
        {session ? (
          <div className="shell">
            <aside className="sidebar">
              <div className="brand">
                <div className="brand-mark" aria-hidden="true" />
                <div className="brand-text">
                  <span className="brand-name display">AgencyOS</span>
                  <span className="brand-sub">Control Room</span>
                </div>
              </div>
              <SidebarNav pendingCount={pendingCount} />
              <div className="sidebar-spacer" />
              {roster && <AgentRoster roster={roster} />}
              <div className="sidebar-footer">
                <div className="account">
                  <span className="avatar" aria-hidden="true">{accountInitials}</span>
                  <div className="account-meta">
                    <span className="account-name">{accountName}</span>
                    <span className="account-role">{session.user.role}</span>
                  </div>
                </div>
                <div className="sidebar-actions">
                  <ThemeToggle />
                  <form
                    action={async () => {
                      "use server";
                      await signOut({ redirectTo: "/login" });
                    }}
                  >
                    <button type="submit" className="btn btn-sm btn-ghost">Sign out</button>
                  </form>
                </div>
              </div>
            </aside>
            <div className="content">
              <TopBar pendingCount={pendingCount} />
              {children}
            </div>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}

/** Up to two initials from a display name or email, for the account avatar. */
function initials(nameOrEmail: string): string {
  const base = nameOrEmail.split("@")[0];
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const letters = (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : base.slice(0, 2)) || "?";
  return letters.toUpperCase();
}
