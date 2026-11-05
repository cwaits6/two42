import Link from "next/link";
import { siteConfig } from "@/lib/config";

/** The wordmark link, or the 42 mark alone where there is no room for it. */
export function Wordmark({ href, mark = false }: { href: string; mark?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center rounded-lg ${mark ? "w-11 justify-center" : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mark ? "/brand/two42-mark.svg" : "/brand/two42-wordmark.svg"}
        alt={siteConfig.name}
        width={mark ? 32 : 108}
        height={mark ? 32 : 28}
        className={mark ? "h-8 w-8" : "h-7 w-auto"}
      />
    </Link>
  );
}
