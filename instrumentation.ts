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
