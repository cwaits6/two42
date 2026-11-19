"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { PayQrCode } from "@/components/giving/PayQrCode";
import { useCoarsePointer } from "@/components/giving/useCoarsePointer";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  methodHref,
  parseGiveAmount,
  venmoPayHref,
  type ResolvedMethod,
} from "@/lib/giving/methods";

/** Text chip for a payment method (no trademarked logos) */
export function MethodChip({
  method,
  size = "md",
}: {
  method: ResolvedMethod["meta"];
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-lg bg-brand-warm font-bold text-brand-primary-text ${
        size === "sm" ? "h-7 w-7 text-sm" : "h-10 w-10 text-lg"
      }`}
    >
      {method.glyph}
    </span>
  );
}

const ACTION = "flex items-center gap-1.5 text-base font-semibold text-brand-primary-text";
const FRAME =
  "flex min-h-11 w-full items-start gap-3.5 rounded-xl border border-border bg-card px-4 py-3";
const HOVER = "transition-colors hover:border-brand-primary/50";

async function copyHandle({ meta, handle }: ResolvedMethod) {
  try {
    await navigator.clipboard.writeText(handle);
    toast.success(`Copied ${handle}`, {
      description: `Paste it in ${meta.name} to send.`,
    });
  } catch {
    toast.error(`Couldn't copy ${handle}. Enter it in ${meta.name} yourself.`);
  }
}

function MethodDetails({ resolved }: { resolved: ResolvedMethod }) {
  const { meta, handle } = resolved;
  // Don't double the prefix when the stored handle already includes it
  const displayHandle =
    meta.prefix && handle.toLowerCase().startsWith(meta.prefix.toLowerCase())
      ? handle.slice(meta.prefix.length)
      : handle;
  return (
    <>
      <span className="block text-base font-semibold text-foreground">{meta.name}</span>
      <span className="block break-words text-base text-muted-foreground">
        {meta.prefix}
        {displayHandle}
      </span>
    </>
  );
}

/**
 * One payment option. Venmo opens a payment for the fund; PayPal and Cash App
 * open the payer's own app in a new tab; copy methods (Zelle, Apple/Google
 * Pay) copy the account to the clipboard since they have no public profile
 * URLs.
 */
export function MethodButton({
  resolved,
  fundName,
}: {
  resolved: ResolvedMethod;
  fundName: string;
}) {
  const { meta, handle } = resolved;

  if (meta.kind === "pay") {
    return <VenmoMethod resolved={resolved} fundName={fundName} />;
  }

  if (meta.kind === "link") {
    return (
      <a
        href={methodHref(meta.key, handle)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${FRAME} ${HOVER}`}
      >
        <MethodChip method={meta} />
        <span className="min-w-0 flex-1 text-left">
          <MethodDetails resolved={resolved} />
          <span className={`mt-1 ${ACTION}`}>
            {meta.verb}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </span>
        </span>
      </a>
    );
  }

  return (
    <button type="button" className={`${FRAME} ${HOVER}`} onClick={() => copyHandle(resolved)}>
      <MethodChip method={meta} />
      <span className="min-w-0 flex-1 text-left">
        <MethodDetails resolved={resolved} />
        <span className={`mt-1 ${ACTION}`}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy
        </span>
      </span>
    </button>
  );
}

/**
 * Venmo's website can't start a payment, so a phone or tablet gets an
 * optional amount and a link into the app, and a computer gets the handle and
 * a QR code of the same link to scan with a phone. The amount is never stored.
 */
function VenmoMethod({ resolved, fundName }: { resolved: ResolvedMethod; fundName: string }) {
  const coarse = useCoarsePointer();

  return (
    <div className={FRAME}>
      <MethodChip method={resolved.meta} />
      <div className="min-w-0 flex-1 text-left">
        <MethodDetails resolved={resolved} />
        {coarse === true && <VenmoPhoneAction resolved={resolved} fundName={fundName} />}
        {coarse === false && <VenmoComputerAction resolved={resolved} fundName={fundName} />}
      </div>
    </div>
  );
}

function VenmoPhoneAction({ resolved, fundName }: { resolved: ResolvedMethod; fundName: string }) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [showError, setShowError] = useState(false);
  const parsed = parseGiveAmount(typed);
  const error = showError && !parsed.ok ? parsed.error : undefined;

  return (
    <div className="mt-3 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={id}>Amount (optional)</Label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-muted-foreground"
          >
            $
          </span>
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              if (parseGiveAmount(e.target.value).ok) setShowError(false);
            }}
            onBlur={() => setShowError(true)}
            {...invalidFieldProps(id, error)}
            className="h-11 pl-7 text-base"
          />
        </div>
        <FieldError fieldId={id} message={error} />
      </div>
      {parsed.ok ? (
        <a
          href={venmoPayHref(resolved.handle, fundName, parsed.amount)}
          target="_blank"
          rel="noopener noreferrer"
          className={`min-h-11 ${ACTION} hover:underline`}
        >
          {resolved.meta.verb}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : (
        // A button, not a link, so a middle-click or long-press can't open Venmo with the bad amount dropped.
        <button
          type="button"
          onClick={() => {
            setShowError(true);
            document.getElementById(id)?.focus();
          }}
          className={`min-h-11 ${ACTION} hover:underline`}
        >
          {resolved.meta.verb}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function VenmoComputerAction({ resolved, fundName }: { resolved: ResolvedMethod; fundName: string }) {
  return (
    <div className="mt-1 space-y-3">
      <button
        type="button"
        onClick={() => copyHandle(resolved)}
        className={`min-h-11 ${ACTION} hover:underline`}
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
        Copy
      </button>
      <div className="flex flex-wrap items-center gap-4">
        <PayQrCode
          value={venmoPayHref(resolved.handle, fundName, null)}
          label={`QR code to pay ${resolved.handle} in Venmo for ${fundName}`}
        />
        <p className="max-w-56 text-base text-muted-foreground">
          Scan with your phone&apos;s camera to pay in Venmo.
        </p>
      </div>
    </div>
  );
}
