"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";
import s from "./shell.module.css";

const NAV_GROUPS: { label: string; items: [string, string][] }[] = [
  {
    label: "STUDIO",
    items: [
      ["/panel", "Panel"],
      ["/videos", "Videos"],
      ["/queue", "Queue"],
      ["/pipeline", "Pipeline"],
      ["/channels", "Channels"],
      ["/themes", "Themes"],
      ["/overlays", "Overlays"],
    ],
  },
  {
    label: "OPERATION",
    items: [
      ["/monitoring", "Monitoring"],
      ["/library", "Library"],
      ["/admin", "Admin"],
    ],
  },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Sidebar({ name, role }: { name: string; role: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <nav className={s.sidebar}>
      <div className={s.logo}>L.</div>
      <div className={s.search}>
        Search… <span className={s.kbd}>Ctrl K</span>
      </div>
      <div className={s.nav}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} style={{ display: "contents" }}>
            <div className={`${s.navGroup}${gi > 0 ? " " + s.spaced : ""}`}>{group.label}</div>
            {group.items.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={`${s.navLink}${isActive(href) ? " " + s.active : ""}`}
              >
                <span className={s.dot} />
                {label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className={s.userBox}>
        <div className={s.avatar}>{initials(name)}</div>
        <div className={s.userMeta}>
          <div className={s.userName}>{name}</div>
          <div className={s.userRole}>{role.charAt(0).toUpperCase() + role.slice(1)}</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
