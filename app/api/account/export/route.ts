import { currentPerson } from "@/lib/account/currentPerson";
import { buildAccountExport } from "@/lib/account/export";
import { logError } from "@/lib/log";

export async function GET() {
  const person = await currentPerson();
  if (!person.ok) {
    return new Response(person.status === 401 ? "Unauthorized" : "Forbidden", {
      status: person.status,
    });
  }

  try {
    const data = await buildAccountExport(person.orgId, person.id);
    if (!data) return new Response("Not found", { status: 404 });
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="my-two42-data.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logError("Account export failed", err, { route: "/api/account/export" });
    return new Response("Failed to build export", { status: 500 });
  }
}
