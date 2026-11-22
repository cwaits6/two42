"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { useCoarsePointer } from "@/components/giving/useCoarsePointer";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  methodHref,
  parseGiveAmount,
  venmoAppHref,
  venmoWebPayHref,
  type ResolvedMethod,
} from "@/lib/giving/methods";

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
    return <LinkCard resolved={resolved} href={methodHref(meta.key, handle)} />;
  }

  return (
    <button type="button" className={`${FRAME} ${HOVER}`} onClick={() => copyHandle(resolved)}>
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

/** A whole-card link that opens the method's site or app in a new tab. */
function LinkCard({ resolved, href }: { resolved: ResolvedMethod; href: string | undefined }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${FRAME} ${HOVER}`}>
      <span className="min-w-0 flex-1 text-left">
        <MethodDetails resolved={resolved} />
        <span className={`mt-1 ${ACTION}`}>
          {resolved.meta.verb}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </span>
      </span>
    </a>
  );
}

/**
 * A phone or tablet gets an optional amount and the app link, falling back
 * to Venmo's web payment page; a computer gets that page directly. The amount
 * is never stored.
 */
function VenmoMethod({ resolved, fundName }: { resolved: ResolvedMethod; fundName: string }) {
  const coarse = useCoarsePointer();

  if (coarse === false) {
    return <LinkCard resolved={resolved} href={venmoWebPayHref(resolved.handle, fundName, null)} />;
  }
  return (
    <div className={FRAME}>
      <div className="min-w-0 flex-1 text-left">
        <MethodDetails resolved={resolved} />
        {coarse === true && <VenmoPhoneAction resolved={resolved} fundName={fundName} />}
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
  const [notOpened, setNotOpened] = useState(false);
  function flagAmount() {
    setShowError(true);
    document.getElementById(id)?.focus();
  }
  const stopWatching = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWatching.current?.(), []);

  // A page that is still in front a moment after the tap means the app
  // didn't take it, most often because Venmo isn't installed on this phone.
  function watchForApp() {
    stopWatching.current?.();
    setNotOpened(false);
    const timer = window.setTimeout(() => {
      stop();
      if (document.visibilityState === "visible") setNotOpened(true);
    }, 2500);
    const left = () => stop();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
    };
    function stop() {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", left);
      window.removeEventListener("blur", left);
      document.removeEventListener("visibilitychange", onVisibility);
      stopWatching.current = null;
    }
    window.addEventListener("pagehide", left);
    window.addEventListener("blur", left);
    document.addEventListener("visibilitychange", onVisibility);
    stopWatching.current = stop;
  }

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
          href={venmoAppHref(resolved.handle, fundName, parsed.amount)}
          onClick={watchForApp}
          className={`min-h-11 ${ACTION} hover:underline`}
        >
          {resolved.meta.verb}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : (
        // A button, not a link, so a middle-click or long-press can't open Venmo with the bad amount dropped.
        <button
          type="button"
          onClick={flagAmount}
          className={`min-h-11 ${ACTION} hover:underline`}
        >
          {resolved.meta.verb}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {notOpened && (
        <div role="status" className="space-y-1">
          <p className="text-base text-muted-foreground">
            Venmo didn&apos;t open. If the app isn&apos;t on this phone, use Venmo&apos;s website
            instead.
          </p>
          {parsed.ok ? (
            <a
              href={venmoWebPayHref(resolved.handle, fundName, parsed.amount)}
              className={`min-h-11 ${ACTION} hover:underline`}
            >
              Open Venmo&apos;s website
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : (
            <button type="button" onClick={flagAmount} className={`min-h-11 ${ACTION} hover:underline`}>
              Open Venmo&apos;s website
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
