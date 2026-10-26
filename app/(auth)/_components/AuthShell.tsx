import React from "react";
import Link from "next/link";

export interface AuthShellProps {
  eyebrow: string;
  title: string;
  /** Italic brand-primary emphasis word that follows the title */
  em: string;
  kicker?: string;
  altPrompt?: string;
  altLabel?: string;
  altHref?: string;
  children: React.ReactNode;
}

/**
 * Two-column auth layout body, rendered between the global Header and Footer.
 *
 * Left column: verse panel (espresso ground). The wordmark lives in the
 * Header, so the panel carries no brand mark of its own.
 * Right column: form area (warm paper background).
 *
 * Mobile: stacks to single column with the verse as a short banner on top.
 */
export function AuthShell({
  eyebrow,
  title,
  em,
  kicker,
  altPrompt,
  altLabel,
  altHref,
  children,
}: AuthShellProps) {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      {/* ── LEFT — verse panel ── */}
      <div className="relative flex flex-col justify-center bg-brand-navy px-8 py-10 text-white md:px-14 md:py-14">
        <figure className="relative max-w-[460px]">
          <div
            className="hidden font-serif text-[5rem] font-semibold leading-none text-brand-accent md:block"
            style={{ marginBottom: "0.35rem" }}
            aria-hidden
          >
            &ldquo;
          </div>
          <blockquote className="font-serif text-2xl italic leading-[1.3] tracking-[-0.025em] text-white md:text-[2rem] md:leading-[1.25]">
            They devoted themselves to the apostles&rsquo; teaching and to fellowship, to the
            breaking of bread and to prayer.
          </blockquote>
          <figcaption className="mt-4 font-sans text-base font-bold uppercase tracking-[0.2em] text-brand-accent">
            Acts 2:42
          </figcaption>
        </figure>
      </div>

      {/* ── RIGHT — form panel ── */}
      <div className="relative bg-background flex flex-col justify-center px-6 py-12 md:px-16 md:py-14">
        <div className="relative w-full max-w-[420px] mx-auto md:mx-0">
          {/* Eyebrow */}
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-5 h-px bg-brand-accent" aria-hidden />
            <span className="font-sans text-base font-bold tracking-[0.2em] uppercase text-brand-accent">
              {eyebrow}
            </span>
          </div>

          {/* Title */}
          <h1 className="font-serif text-4xl md:text-5xl font-medium text-foreground tracking-tight leading-[1.05] mb-0">
            {title}{" "}
            <em className="not-italic italic text-brand-primary">{em}</em>.
          </h1>

          {kicker && (
            <p className="font-sans text-base text-muted-foreground leading-[1.6] mt-3.5 mb-0">
              {kicker}
            </p>
          )}

          {/* Form / children */}
          <div className="mt-8">{children}</div>

          {/* Alt link (optional) */}
          {altPrompt && altLabel && altHref && (
            <div className="mt-8 pt-6 border-t border-border">
              <p className="font-sans text-lg text-muted-foreground">
                {altPrompt}{" "}
                <Link
                  href={altHref}
                  className="text-brand-primary font-semibold hover:underline"
                >
                  {altLabel}
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
