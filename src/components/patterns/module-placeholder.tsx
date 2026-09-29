import { Construction } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";

export function ModulePlaceholder({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EmptyState
        icon={Construction}
        title="This module is being rebuilt"
        description="Navigation and role access are wired up. The full screen is coming next in this rebuild sequence."
      />
    </div>
  );
}
