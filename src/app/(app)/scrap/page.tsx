"use client";

import { useRouter } from "next/navigation";
import { ScrapTracking } from "@/components/scrap/scrap-tracking";
import { useEffectiveUser } from "@/lib/effective-user";

export default function ScrapPage() {
  const { user } = useEffectiveUser();
  const router = useRouter();

  return <ScrapTracking user={user} onOpenUsers={() => router.push("/team")} />;
}
