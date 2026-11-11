import { groupInitials } from "@/lib/groups/active";
import { groupTextColor } from "@/lib/groups/settings";
import { cn } from "@/lib/utils";

/** A group's initials on its own color. */
export function GroupAvatar({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-bold",
        className
      )}
      style={{ backgroundColor: color, color: groupTextColor(color) }}
    >
      {groupInitials(name)}
    </span>
  );
}
