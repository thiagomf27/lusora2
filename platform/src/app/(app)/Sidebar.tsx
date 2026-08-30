"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import s from "./shell.module.css";

/** The top-level destinations. Four are the ones the design draws (Brands is
 *  not among them any more: a brand profile is the channel's config document,
 *  so it is a tab on Channels rather than a route of its own). Library is the
 *  fifth, and is ours: it is where footage comes from, it is the only screen
 *  with a queue someone has to keep clearing, and burying it under a collapsed
 *  section made both of those invisible. */
const NAV: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 12.5V6l5.5-4 5.5 4v6.5" />
        <path d="M6 12.5V9h4v3.5" />
      </svg>
    ),
  },
  {
    href: "/channels",
    label: "Channels",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4.5" width="12" height="8.5" rx="2" />
        <path d="M5.5 4.5L8 1.8l2.5 2.7" />
      </svg>
    ),
  },
  {
    href: "/videos",
    label: "Videos",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3.5" width="12" height="9" rx="2" />
        <path d="M6.8 6.5l3 1.5-3 1.5z" />
      </svg>
    ),
  },
  {
    href: "/library",
    label: "Library",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 3.5v9M5.5 3.5v9M9 3.8l4 8.2" />
        <rect x="1.2" y="2.6" width="13.6" height="10.8" rx="2" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" />
      </svg>
    ),
  },
];

/** Authoring/ops screens the design does not draw — real routes that would
 *  otherwise be unreachable, so they live in a collapsible section. Things you
 *  set up once, not things you come back to daily. */
/** The library's other three screens. They are shown nested under Library and
 *  only while a library route is active: they are places you go once you are
 *  already in there, and a nav that carried all four at all times would be a
 *  nav mostly about the library. */
const LIBRARY_SUB: [string, string][] = [
  ["/library/ingest", "Ingest"],
  ["/library/review", "Review"],
  ["/library/overview", "Overview"],
];

const STUDIO: [string, string][] = [
  ["/queue", "Queue"],
  ["/pipeline", "Pipeline"],
  ["/themes", "Themes"],
  ["/style-packs", "Style packs"],
  ["/prompts", "Prompts"],
  ["/overlays", "Overlays"],
  ["/sounds", "Sounds"],
  ["/panel", "Panel"],
  ["/monitoring", "Monitoring"],
  ["/admin", "Admin"],
];

interface RecentVideo {
  id: string;
  title: string;
}

/** Badges for the library's screens. The pending count is the one number in
 *  the system that gates everything downstream — a clip nobody has reviewed is
 *  invisible to search AND to the worker — so it is worth a poll and a badge
 *  rather than something you find by navigating to it. Silent on failure: an
 *  unreachable library must not make the whole nav look broken, and zeroing the
 *  count would read as "nothing to review". */
function useLibraryBadges() {
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const [stats, jobs] = await Promise.all([
          fetch("/api/library/stats").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/library/jobs?limit=50").then((r) => (r.ok ? r.json() : [])),
        ]);
        if (stop) return;
        const running = Array.isArray(jobs)
          ? jobs.filter((j: { status: string }) =>
              ["queued", "preparing", "downloading", "tagging", "cutting", "storing"]
                .includes(j.status)).length
          : 0;
        setBadges({
          "/library/review": stats?.pending ?? 0,
          "/library/ingest": running,
        });
      } catch {
        /* library down: leave the badges as they were rather than zeroing them,
           which would read as "nothing to review" */
      }
    };
    void tick();
    const t = setInterval(tick, 15000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return badges;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Chevron({ flipped }: { flipped: boolean }) {
  return (
    <svg
      className={flipped ? s.flipped : undefined}
      width="13" height="13" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export default function Sidebar({ name, role }: { name: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [studioOpen, setStudioOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [recent, setRecent] = useState<RecentVideo[]>([]);
  const badges = useLibraryBadges();

  useEffect(() => {
    fetch("/api/videos")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: RecentVideo[]) => setRecent(rows.slice(0, 4)))
      .catch(() => setRecent([]));
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className={`${s.sidebar}${open ? "" : " " + s.collapsed}`}>
      <div className={s.head}>
        <Link href="/" className={s.brand}>
          <svg className={s.brandMark} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h5A2.5 2.5 0 0 1 12 4.5v7A2.5 2.5 0 0 1 9.5 14h-5A2.5 2.5 0 0 1 2 11.5z" />
            <path d="M12 6.5l2.2-1.3v5.6L12 9.5" />
          </svg>
          <span>Lusora</span>
        </Link>
        <button
          type="button"
          className={s.collapseBtn}
          title={open ? "Collapse sidebar" : "Expand sidebar"}
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="12" height="10" rx="2" />
            <path d="M6.5 3v10" />
          </svg>
        </button>
      </div>

      <nav className={s.nav}>
        {NAV.map((item) => (
          <div key={item.href}>
            <Link
              href={item.href}
              title={open ? undefined : item.label}
              className={`${s.navLink}${isActive(item.href) ? " " + s.active : ""}`}
            >
              {item.icon}
              <span className={s.navLabel}>{item.label}</span>
              {/* Pending review gates everything downstream — an unreviewed
                  clip is invisible to search AND to the worker — so it rides
                  on the nav itself. Collapsed, the badge is a dot: the number
                  has nowhere to go once the labels are hidden, but "there is
                  something waiting" still fits. */}
              {item.href === "/library" && badges["/library/review"] ? (
                <span className={s.badgeWarn} title="clips awaiting review">
                  {badges["/library/review"]}
                </span>
              ) : null}
            </Link>
            {item.href === "/library" && open && isActive("/library") && (
              <div className={s.navSub}>
                {LIBRARY_SUB.map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    className={`${s.subLink}${pathname === href ? " " + s.active : ""}`}
                  >
                    {label}
                    {badges[href] ? (
                      <span className={href === "/library/review" ? s.badgeWarn : s.badgeInfo}>
                        {badges[href]}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {open && (
        <div className={s.scroll}>
          <button type="button" className={s.sectionHead} onClick={() => setStudioOpen((o) => !o)}>
            Studio
            <Chevron flipped={studioOpen} />
          </button>
          {studioOpen && (
            <div className={s.sectionBody}>
              {STUDIO.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className={`${s.subLink}${isActive(href) ? " " + s.active : ""}`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}

          <button type="button" className={s.sectionHead} onClick={() => setRecentOpen((o) => !o)}>
            Recent projects
            <Chevron flipped={recentOpen} />
          </button>
          {recentOpen && (
            <div className={s.sectionBody}>
              {recent.map((v) => (
                <Link key={v.id} href={`/videos/${v.id}`} className={s.subLink} title={v.title}>
                  {v.title}
                </Link>
              ))}
              {recent.length === 0 && <div className={s.emptyNote}>No videos yet.</div>}
            </div>
          )}
        </div>
      )}

      <div className={s.footer}>
        <div className={s.userBox}>
          <div className={s.avatar}>{initials(name)}</div>
          {open && (
            <>
              <div className={s.userMeta}>
                <div className={s.userName}>{name}</div>
                <div className={s.userRole}>{role.charAt(0).toUpperCase() + role.slice(1)}</div>
              </div>
              <button
                type="button"
                className={s.collapseBtn}
                title="Sign out"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/login");
                }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6.5 2.5H4a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 4 13.5h2.5" />
                  <path d="M10 5.5L12.5 8 10 10.5M12.5 8h-6" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
