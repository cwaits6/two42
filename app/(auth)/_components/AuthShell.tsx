import React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";

export interface AuthShellProps {
  /** Small label above the title; leave it out when it would repeat the title */
  eyebrow?: string;
  title: string;
  /** Italic brand-primary emphasis word that follows the title, then a period */
  em?: string;
  kicker?: React.ReactNode;
  altPrompt?: string;
  altLabel?: string;
  altHref?: string;
  children: React.ReactNode;
}

/**
 * Two-column body for every signed-out card, rendered between the global
 * Header and Footer.
 *
 * Left column: verse panel (espresso ground). The wordmark lives in the
 * Header, so the panel carries no brand mark of its own.
 * Right column: form area (warm paper background).
 *
 * Phone: one column with the form first, so it is on screen without
 * scrolling; the verse follows it.
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
    <div className="grid grid-cols-1 md:min-h-screen md:grid-cols-2">
      {/* ── LEFT — verse panel ── */}
      <div className="relative order-last flex flex-col justify-center bg-brand-navy px-6 py-10 text-white md:order-none md:px-14 md:py-14">
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
      <div className="relative flex flex-col justify-center bg-background px-4 py-8 sm:px-6 md:px-16 md:py-14">
        <div className="relative mx-auto w-full max-w-[420px] md:mx-0">
          {eyebrow && (
            <div className="mb-4 flex items-center gap-2.5">
              <div className="h-px w-5 bg-brand-accent" aria-hidden />
              <span className="font-sans text-base font-bold uppercase tracking-[0.2em] text-brand-accent-text">
                {eyebrow}
              </span>
            </div>
          )}

          <PageHeader
            className="mb-0"
            title={
              em ? (
                <>
                  {title} <em className="italic text-brand-primary-text">{em}</em>.
                </>
              ) : (
                title
              )
            }
            subtitle={kicker}
          />

          <div className="mt-6 md:mt-8">{children}</div>

          {altPrompt && altLabel && altHref && (
            <div className="mt-6 border-t border-border pt-4 md:mt-8 md:pt-6">
              <p className="font-sans text-lg text-muted-foreground">
                {altPrompt}{" "}
                <Link
                  href={altHref}
                  className="inline-flex min-h-11 items-center font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
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
