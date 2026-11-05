import type { Instrumentation } from "next";
import { digestReference, writeLog } from "./lib/log/core";

// Next.js instrumentation entry point (loaded once at server boot).
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// OpenTelemetry setup is deliberately:
// - Node.js-only: the edge runtime (lib/supabase/middleware.ts) has no OTel
//   auto-instrumentation support, so it is never touched here.
// - Opt-in via env: when OTEL_EXPORTER_OTLP_ENDPOINT is unset, register() is a
//   silent no-op and nothing OTel-related is even imported. Local dev and
//   current production behavior are unchanged.
// - Vendor-neutral: the OTLP endpoint/headers come entirely from standard env
//   vars (see .env.example), so the same build runs on Vercel today and a k8s
//   pod exporting to an in-cluster Collector later.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  await import("./instrumentation.node");
}

// An error nothing caught reaches app/error.tsx with only the framework's
// digest, so that digest is the reference this line is written under.
export const onRequestError: Instrumentation.onRequestError = (error, _request, context) => {
  writeLog(
    "error",
    "Request failed with an error nothing caught",
    error,
    // The framework's route pattern; the request's own path is never read.
    { route: context.routePath, step: context.routeType },
    digestReference(error),
  );
};
