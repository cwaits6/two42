import { CircleCheck, Clock, PenLine, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AnnouncementStatus } from "@/lib/announcements";

const LOOK: Record<AnnouncementStatus, { icon: LucideIcon; variant: "secondary" | "outline" }> = {
  Published: { icon: CircleCheck, variant: "secondary" },
  Scheduled: { icon: Clock, variant: "outline" },
  Draft: { icon: PenLine, variant: "outline" },
};

export function AnnouncementStatusBadge({ status }: { status: AnnouncementStatus }) {
  const { icon: Icon, variant } = LOOK[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" />
      {status}
    </Badge>
  );
}
