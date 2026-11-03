import { currentPerson } from "@/lib/account/currentPerson";
import { deletePerson, deletionResponse, loadDeletionSummary } from "@/lib/account/deletion";

function denied(status: 401 | 403) {
  return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function GET() {
  const person = await currentPerson();
  if (!person.ok) return denied(person.status);
  try {
    const summary = await loadDeletionSummary(person.orgId, person.id);
    return summary
      ? Response.json(summary)
      : Response.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("Deletion summary failed:", err instanceof Error ? err.message : typeof err);
    return Response.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function DELETE() {
  const person = await currentPerson();
  if (!person.ok) return denied(person.status);
  const result = await deletePerson(person.orgId, person.id);
  // The account is already gone, so a failed sign-out only leaves a dead cookie.
  if (result === "deleted") await person.signOut().catch(() => undefined);
  return deletionResponse(result);
}
