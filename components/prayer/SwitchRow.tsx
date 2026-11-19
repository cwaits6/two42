"use client";

import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";

export function SwitchRow({
  id,
  on,
  onToggle,
  title,
  sub,
  icon,
}: {
  id: string;
  on: boolean;
  onToggle: (checked: boolean) => void;
  title: string;
  sub: string;
  icon: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        on
          ? "border-brand-primary/40 bg-brand-warm"
          : "border-border bg-card hover:border-brand-primary/30"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          on
            ? "bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-foreground">
          {title}
        </span>
        <span className="block text-sm leading-snug text-muted-foreground">
          {sub}
        </span>
      </span>
      <Switch id={id} checked={on} onCheckedChange={onToggle} />
    </label>
  );
}
