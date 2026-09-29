"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { getPrimaryNav, ownerPreviews } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useEffectiveUser } from "@/lib/effective-user";
import { roleLabels } from "@/lib/types";

function useHeaderTitle() {
  const { user } = useSession();
  const pathname = usePathname();
  if (pathname.startsWith("/preview/")) {
    const preview = ownerPreviews.find((p) => pathname.startsWith(p.href));
    return preview?.label ?? "LAL Motors";
  }
  const nav = getPrimaryNav(user.role);
  const match = nav.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  return match?.label ?? "LAL Motors";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useSession();
  const title = useHeaderTitle();
  const { isPreview, previewLabel } = useEffectiveUser();
  const router = useRouter();

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 hidden w-[272px] border-r border-sidebar-border md:block">
        <SidebarNav />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[272px] max-w-[85vw] p-0 sm:max-w-[272px]">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-h-screen flex-1 flex-col md:ml-[272px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center gap-4 border-b border-border bg-background px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              LAL Motors · {roleLabels[user.role]}
            </p>
            <h1 className="truncate text-lg font-semibold sm:text-xl">{title}</h1>
          </div>
        </header>
        {isPreview && (
          <div className="mx-4 mt-4 flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm sm:mx-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-primary">Owner testing · {previewLabel}</p>
              <p className="mt-0.5 text-muted-foreground">
                Use this role&apos;s screen and actions. Changes are saved under your Owner account.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => router.push("/vehicles")}
            >
              Return to Owner Dashboard
            </Button>
          </div>
        )}
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

export function PreviewSubNav({
  items,
  active,
  onChange,
}: {
  items: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
      {items.map((item) => (
        <Button
          key={item.id}
          type="button"
          variant={active === item.id ? "default" : "outline"}
          size="sm"
          className="shrink-0"
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm font-medium text-primary hover:underline">
      {label}
    </Link>
  );
}
