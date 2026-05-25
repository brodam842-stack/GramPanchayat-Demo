"use client";
import { ReactNode, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

interface Admin { name: string; email: string; role: string; }

function NavItem({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`nav-item ${active ? "active" : ""}`}>
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("gp_token");
    const adminData = localStorage.getItem("gp_admin");
    if (!token) { router.replace("/login"); return; }
    if (adminData) setAdmin(JSON.parse(adminData));
  }, [router]);

  function handleLogout() {
    localStorage.removeItem("gp_token");
    localStorage.removeItem("gp_admin");
    router.replace("/login");
  }

  const navItems = [
    { href: "/dashboard",           icon: "📊", label: "Overview"        },
    { href: "/dashboard/citizens",  icon: "👥", label: "Citizens"        },
    { href: "/dashboard/documents", icon: "📄", label: "Documents"       },
    { href: "/dashboard/forms",     icon: "📝", label: "Blank Forms"     },
    { href: "/dashboard/broadcast", icon: "📢", label: "Bulk Message"    },
    { href: "/dashboard/analytics", icon: "📈", label: "Analytics"       },
    { href: "/dashboard/audit",     icon: "🔍", label: "Audit Logs"      },
    { href: "/dashboard/blocked",   icon: "🚫", label: "Blocked Numbers" },
    { href: "/dashboard/settings",  icon: "⚙️", label: "Settings"        },
  ];

  return (
    <div className="dashboard-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">🏛</div>
          <div className="logo-text" style={{ marginTop: "8px" }}>Gram Panchayat</div>
          <div className="logo-sub">Document Service Admin</div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Main</div>
          {navItems.slice(0, 5).map(n => (
            <NavItem key={n.href} {...n} active={pathname === n.href} />
          ))}

          <div className="nav-section-label">Management</div>
          {navItems.slice(5).map(n => (
            <NavItem key={n.href} {...n} active={pathname === n.href} />
          ))}
        </nav>

        <div className="sidebar-footer">
          {admin && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f9fafb" }}>{admin.name}</div>
              <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>{admin.email}</div>
              <span className="badge badge-info" style={{ marginTop: "4px", fontSize: "0.65rem" }}>
                {admin.role.replace("_", " ")}
              </span>
            </div>
          )}
          <button onClick={handleLogout} className="btn btn-secondary btn-sm" style={{ width: "100%" }}>
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="main-content">{children}</main>
    </div>
  );
}
