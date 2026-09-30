"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { getPrimaryNav } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { roleLabels, rolePhaseLabels } from "@/lib/types";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user, setUserId, users } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const nav = getPrimaryNav(user.role);

  function signOut() {
    setUserId(users[0].id);
    router.push("/login");
    onNavigate?.();
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 border-b border-sidebar-border bg-black/10 px-5 py-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-gold text-lg font-bold text-accent-gold-foreground shadow-sm">
          L
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-wide">LAL MOTORS</p>
          <p className="text-[10px] font-medium tracking-[0.16em] text-sidebar-foreground/50 uppercase">
            Operating System
          </p>
        </div>
      </div>
      <nav className="sidebar-scroll flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex h-10 items-center gap-3 rounded-md border-l-2 px-3 text-sm font-medium transition-colors",
                active
                  ? "border-accent-gold bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "border-transparent text-sidebar-foreground/65 hover:border-sidebar-foreground/20 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/50")} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-3 pb-3">
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3.5">
          <p className="text-[10px] font-bold tracking-[0.14em] text-accent-gold uppercase">
            Live Operations
          </p>
          <p className="mt-1 text-sm font-semibold">{rolePhaseLabels[user.role]}</p>
          <p className="mt-1 text-xs text-sidebar-foreground/50">
            One production database · role-protected access
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-sidebar-border px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {user.name[0]}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-sidebar-foreground/50">{roleLabels[user.role]}</p>
        </div>
      </div>
      <div className="px-5 pb-5">
        <Button variant="outline" size="sm" className="w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
