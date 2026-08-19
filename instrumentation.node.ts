// OpenTelemetry NodeSDK setup. Only ever imported by instrumentation.ts, and
// only when NEXT_RUNTIME === "nodejs" and OTEL_EXPORTER_OTLP_ENDPOINT is set.
//
// Uses the standard @opentelemetry/sdk-node (not @vercel/otel) so the exact
// same instrumentation runs on Vercel and on a long-running k8s pod. The OTLP
// exporter reads OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS from
// the environment itself — no backend or vendor is named in app code.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { name as serviceName, version as serviceVersion } from "./package.json";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    // OTEL_SERVICE_NAME (read by the SDK's default resource) still wins if
    // set; this is the fallback identity derived from package.json.
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
  }),
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      // fs instrumentation is extremely noisy under Next.js (every module
      // resolution shows up as a span) for near-zero diagnostic value.
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

sdk.start();

// Flush pending spans on shutdown. Matters for k8s (SIGTERM on pod
// termination/rollout) and is harmless on Vercel.
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .catch((error) =>
      console.error("[otel] error shutting down OpenTelemetry SDK", error),
    );
});
