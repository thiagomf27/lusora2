import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

const NAV = [
  ["/panel", "Panel"],
  ["/queue", "Queue"],
  ["/pipeline", "Pipeline"],
  ["/videos", "Videos"],
  ["/channels", "Channels"],
  ["/monitoring", "Monitoring"],
  ["/admin", "Admin"],
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 190,
          borderRight: "1px solid var(--border)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ fontWeight: 700, color: "var(--accent)", marginBottom: 12 }}>lusora</div>
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} style={{ color: "var(--text)", padding: "6px 8px" }}>
            {label}
          </Link>
        ))}
        <div style={{ marginTop: "auto", fontSize: 13, color: "var(--muted)" }}>
          {user.name} · {user.role}
          <LogoutButton />
        </div>
      </aside>
      <main style={{ flex: 1, padding: 24, maxWidth: 1200 }}>{children}</main>
    </div>
  );
}
