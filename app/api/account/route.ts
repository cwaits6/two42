import { currentPerson } from "@/lib/account/currentPerson";
import { deletePerson, deletionResponse, loadDeletionSummary } from "@/lib/account/deletion";
import { logError } from "@/lib/log";

function denied(status: 401 | 403) {
  return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function GET() {
  const person = await currentPerson();
  if (!person.ok) return denied(person.status);
  try {
    const summary = await loadDeletionSummary(person.orgId, person.id, "self");
    return summary
      ? Response.json(summary)
      : Response.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    logError("Deletion summary failed", err, { route: "/api/account" });
    return Response.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function DELETE() {
  const person = await currentPerson();
  if (!person.ok) return denied(person.status);
  const result = await deletePerson(person.orgId, person.id);
  // The account is already gone, so a failed sign-out only leaves a dead cookie.
  if (result.outcome === "deleted") await person.signOut().catch(() => undefined);
  return deletionResponse(result);
}
