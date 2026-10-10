import Link from "next/link";
import { Cake, ChevronRight, Heart, House, Users } from "lucide-react";
import type { ComponentType } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

const tiles: {
  path: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
}[] = [
  { path: "/families", icon: House, title: "Families" },
  { path: "/groups", icon: Users, title: "Groups" },
  { path: "/birthdays", icon: Cake, title: "Birthdays" },
  { path: "/anniversaries", icon: Heart, title: "Anniversaries" },
];

/** The directory landing, rendered at /directory and under a group prefix. */
export function DirectoryTiles({ directoryHref }: { directoryHref: string }) {
  return (
    <PageContainer>
      <PageHeader title="Directory" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {tiles.map((tile) => (
          <Link
            key={tile.path}
            href={`${directoryHref}${tile.path}`}
            className="flex items-center gap-4 rounded-xl border border-border bg-card p-7 hover:border-brand-primary transition-colors"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-warm">
              <tile.icon className="h-6 w-6 text-brand-primary" aria-hidden="true" />
            </span>
            <span className="text-xl font-bold text-foreground">{tile.title}</span>
            <ChevronRight
              className="ml-auto h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
