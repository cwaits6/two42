"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface BackLinkProps {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

/** Quiet underlined back link used at the top of directory sub-pages and panels */
export function BackLink({ href, onClick, children, className }: BackLinkProps) {
  const inner = (
    <>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {children}
    </>
  );
  const cls = `inline-flex min-h-11 items-center gap-2 text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground ${className ?? ""}`;

  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
