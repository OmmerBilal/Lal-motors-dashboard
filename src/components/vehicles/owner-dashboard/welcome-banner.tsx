"use client";

const badges = ["Quality Parts", "Trusted Supply", "Global Export", "Stronger Together"];

/** Branded welcome strip. No yard/building photo asset exists in the repo (checked public/), so this uses a
 * gradient over the app's own brand colour tokens only, per the task's explicit fallback. */
export function WelcomeBanner({ firstName }: { firstName: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-accent-gold/30 bg-gradient-to-br from-brand via-brand to-brand-muted px-5 py-6 text-brand-foreground sm:px-8 sm:py-7">
      <h2 className="text-2xl font-bold sm:text-3xl">Welcome back, {firstName}!</h2>
      <p className="mt-1 text-sm text-brand-foreground/75">Here&apos;s what&apos;s happening across LAL Motors right now.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {badges.map((b) => (
          <span
            key={b}
            className="rounded-full border border-accent-gold/40 bg-accent-gold/10 px-3 py-1 text-xs font-medium text-accent-gold"
          >
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}
