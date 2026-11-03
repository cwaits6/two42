import { deletePerson, deletionResponse, loadDeletionSummary } from "@/lib/account/deletion";
import { isUuid } from "@/lib/groups/active";
import { requireOrgAdmin } from "@/lib/members/access";

type Params = { params: Promise<{ id: string }> };

function denied(status: 401 | 403) {
  return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

function notFound() {
  return Response.json({ error: "Not found" }, { status: 404 });
}

export async function GET(_request: Request, { params }: Params) {
  const gate = await requireOrgAdmin();
  if (!gate.ok) return denied(gate.status);
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    const summary = await loadDeletionSummary(gate.orgId, id);
    return summary ? Response.json(summary) : notFound();
  } catch (err) {
    console.error("Deletion summary failed:", err instanceof Error ? err.message : typeof err);
    return Response.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const gate = await requireOrgAdmin();
  if (!gate.ok) return denied(gate.status);
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  return deletionResponse(await deletePerson(gate.orgId, id));
}
