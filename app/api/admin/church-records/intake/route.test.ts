import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openKey } from "@/lib/integrations/records/crypto";
import { RecordsError } from "@/lib/integrations/records/errors";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({ requireOrgAdmin: () => requireOrgAdmin() }));

const store = vi.hoisted(() => ({ readConnection: vi.fn(), loadCredentials: vi.fn() }));
vi.mock("@/lib/integrations/records/store", () => store);

const intakeStore = vi.hoisted(() => ({
  readIntakeSettings: vi.fn(),
  readIntakeStatus: vi.fn(),
  saveIntakeSettings: vi.fn(),
  deleteIntakeSettings: vi.fn(),
  loadIntakeCredentials: vi.fn(),
}));
vi.mock("@/lib/integrations/records/intake", () => intakeStore);

const stubIntake = vi.hoisted(() => ({
  setup: { keyLabel: "Write key", keyHelp: "", destinationLabel: "inbox", destinationHelp: "" },
  parseDestinationId: (v: unknown) => (typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : null),
  destinations: vi.fn(),
  checkDestination: vi.fn(),
  submitNewPerson: vi.fn(),
}));
const providers = vi.hoisted(() => ({ withIntake: true }));
vi.mock("@/lib/integrations/records/providers", () => ({
  providerFor: (id: unknown) =>
    id === "stub" ? { id: "stub", label: "Stub Records", ...(providers.withIntake ? { intake: stubIntake } : {}) } : null,
}));

import { DELETE, GET, PUT } from "./route";
import { POST as DESTINATIONS } from "./destinations/route";

const CONNECTION = { provider: "stub", baseUrl: "https://records.example.test", keyHint: "9012", connectionId: "c1" };
const SETTINGS = { connectionId: "c1", keyHint: "1234", destinationId: "42", destinationName: "New people", enabledAt: "2026-11-27T00:00:00Z" };
const WRITE_KEY = "write-key-001234";
const READ_KEY = "read-key-009012";
let secret: string;

// Requests come from a form opened against connection c1 unless a test says otherwise.
function put(body: Record<string, unknown>) {
  return PUT(
    new Request("http://test/api/admin/church-records/intake", { method: "PUT", body: JSON.stringify({ connectionId: "c1", ...body }) }),
  );
}
function destinations(body: Record<string, unknown>) {
  return DESTINATIONS(new Request("http://test/x", { method: "POST", body: JSON.stringify({ connectionId: "c1", ...body }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  providers.withIntake = true;
  secret = randomBytes(32).toString("base64");
  process.env.RECORDS_KEY_SECRET = secret;
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", user: { id: "admin-1" } });
  store.readConnection.mockResolvedValue(CONNECTION);
  store.loadCredentials.mockResolvedValue({ creds: { baseUrl: CONNECTION.baseUrl, key: READ_KEY } });
  intakeStore.readIntakeSettings.mockResolvedValue(null);
  intakeStore.readIntakeStatus.mockResolvedValue({ sent: 0, failed: 0, unknown: 0, lastFailure: null });
  intakeStore.saveIntakeSettings.mockResolvedValue("saved");
  intakeStore.loadIntakeCredentials.mockResolvedValue(null);
  stubIntake.checkDestination.mockResolvedValue({ id: "42", name: "New people" });
});

describe("/api/admin/church-records/intake", () => {
  it("doesn't exist without RECORDS_KEY_SECRET, without a connection, or for a provider that can't send", async () => {
    delete process.env.RECORDS_KEY_SECRET;
    expect((await GET()).status).toBe(404);
    process.env.RECORDS_KEY_SECRET = secret;
    store.readConnection.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    store.readConnection.mockResolvedValue(CONNECTION);
    providers.withIntake = false;
    expect((await put({ key: WRITE_KEY, destinationId: "42" })).status).toBe(404);
    expect((await destinations({ key: WRITE_KEY })).status).toBe(404);
    expect(intakeStore.saveIntakeSettings).not.toHaveBeenCalled();
  });

  it("turns away anyone but a church admin", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await GET()).status).toBe(403);
    expect((await put({ key: WRITE_KEY, destinationId: "42" })).status).toBe(403);
    expect((await DELETE()).status).toBe(403);
    expect(intakeStore.deleteIntakeSettings).not.toHaveBeenCalled();
  });

  it("is off until a church admin turns it on, and asks for no key while off", async () => {
    expect(await (await GET()).json()).toEqual({ intake: null, connectionId: "c1" });
    expect(intakeStore.loadIntakeCredentials).not.toHaveBeenCalled();
  });

  it("checks the destination with the write key, then saves the key sealed under its own label", async () => {
    intakeStore.readIntakeSettings.mockResolvedValue(SETTINGS);
    const res = await put({ key: WRITE_KEY, destinationId: "42" });
    expect(res.status).toBe(200);
    expect(stubIntake.checkDestination).toHaveBeenCalledWith({ baseUrl: CONNECTION.baseUrl, key: WRITE_KEY }, "42");
    const saved = intakeStore.saveIntakeSettings.mock.calls[0];
    expect(saved[0]).toBe("org-1");
    expect(saved[1]).toEqual(
      expect.objectContaining({ connectionId: "c1", keyHint: "1234", destinationId: "42", destinationName: "New people", enabledBy: "admin-1" }),
    );
    expect(saved[1].keyCiphertext).not.toContain(WRITE_KEY);
    expect(openKey({ current: Buffer.from(secret, "base64"), previous: null }, "org-1", "stub-intake", saved[1].keyCiphertext)).toBe(WRITE_KEY);
    expect(() => openKey({ current: Buffer.from(secret, "base64"), previous: null }, "org-1", "stub", saved[1].keyCiphertext)).toThrow();
    expect((await res.json()).intake).toEqual(
      expect.objectContaining({ keyHint: "1234", destination: { id: "42", name: "New people" }, sent: 0, failed: 0 }),
    );
  });

  it("refuses the read key, a malformed key and a missing destination before asking the provider", async () => {
    const reused = await put({ key: READ_KEY, destinationId: "42" });
    expect(reused.status).toBe(400);
    expect((await reused.json()).error).toBe("Use a separate key for sending new people, not the key two42 reads with.");
    expect((await put({ key: "has space in it", destinationId: "42" })).status).toBe(400);
    expect((await put({ key: WRITE_KEY, destinationId: "0" })).status).toBe(400);
    expect((await put({ destinationId: "42" })).status).toBe(400);
    expect(stubIntake.checkDestination).not.toHaveBeenCalled();
    expect(intakeStore.saveIntakeSettings).not.toHaveBeenCalled();
  });

  it.each([
    [
      new RecordsError("unauthorized", 401),
      "Stub Records didn't accept the write key, or its role is missing a permission. Check the key is active and its role has every permission the write key instructions list, including View on the inbox.",
    ],
    [
      new RecordsError("unauthorized", 403),
      "Stub Records didn't accept the write key, or its role is missing a permission. Check the key is active and its role has every permission the write key instructions list, including View on the inbox.",
    ],
    [
      new RecordsError("not_found"),
      "Stub Records has no active inbox with that id. Choose another, or check it is active in Stub Records.",
    ],
    [new RecordsError("unreachable"), "Couldn't reach Stub Records. Check that Stub Records is up and answers at the connected address."],
  ])("names the refusal %s plainly and saves nothing", async (refusal, message) => {
    stubIntake.checkDestination.mockRejectedValue(refusal);
    const res = await put({ key: WRITE_KEY, destinationId: "42" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
    expect(intakeStore.saveIntakeSettings).not.toHaveBeenCalled();
  });

  it("keeps the saved key when none is given", async () => {
    intakeStore.loadIntakeCredentials.mockResolvedValue({ connectionId: "c1", creds: { baseUrl: CONNECTION.baseUrl, key: WRITE_KEY } });
    intakeStore.readIntakeSettings.mockResolvedValue(SETTINGS);
    expect((await put({ destinationId: "42" })).status).toBe(200);
    expect(stubIntake.checkDestination).toHaveBeenCalledWith({ baseUrl: CONNECTION.baseUrl, key: WRITE_KEY }, "42");
  });

  it("never sends a saved key from a newer connection to the address it read", async () => {
    intakeStore.loadIntakeCredentials.mockResolvedValue({ connectionId: "c2", creds: { baseUrl: "https://other.example.test", key: WRITE_KEY } });
    expect((await put({ destinationId: "42" })).status).toBe(409);
    expect(stubIntake.checkDestination).not.toHaveBeenCalled();
    expect(intakeStore.saveIntakeSettings).not.toHaveBeenCalled();
  });

  it("answers saved, not a failure, when the setting saved but couldn't be read back", async () => {
    intakeStore.readIntakeSettings.mockResolvedValue(SETTINGS);
    intakeStore.readIntakeStatus.mockRejectedValue(new Error("status read failed"));
    const res = await put({ key: WRITE_KEY, destinationId: "42" });
    expect(intakeStore.saveIntakeSettings).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
  });

  it("never sends a typed key when the form was opened against another connection, or names none", async () => {
    for (const connectionId of ["c0", undefined]) {
      expect((await put({ key: WRITE_KEY, destinationId: "42", connectionId })).status).toBe(409);
      expect((await destinations({ key: WRITE_KEY, connectionId })).status).toBe(409);
    }
    expect(stubIntake.checkDestination).not.toHaveBeenCalled();
    expect(stubIntake.destinations).not.toHaveBeenCalled();
    expect(intakeStore.saveIntakeSettings).not.toHaveBeenCalled();
  });

  it("says so when the connection changed since it was read", async () => {
    intakeStore.saveIntakeSettings.mockResolvedValue("connection_changed");
    expect((await put({ key: WRITE_KEY, destinationId: "42" })).status).toBe(409);
  });

  it("shows the counts and why the newest send failed, never the key", async () => {
    intakeStore.readIntakeSettings.mockResolvedValue(SETTINGS);
    intakeStore.readIntakeStatus.mockResolvedValue({ sent: 3, failed: 1, unknown: 2, lastFailure: "unauthorized" });
    const body = await (await GET()).json();
    expect(intakeStore.readIntakeStatus).toHaveBeenCalledWith("org-1", SETTINGS.enabledAt);
    expect(body.intake).toEqual({
      keyHint: "1234",
      destination: { id: "42", name: "New people" },
      enabledAt: SETTINGS.enabledAt,
      sent: 3,
      failed: 1,
      unknown: 2,
      lastFailure: expect.stringMatching(/didn't accept the write key.*If both are right, choose Change and enter the write key again\.$/),
    });
    expect(JSON.stringify(body)).not.toContain(WRITE_KEY);
  });

  it("turns off for the admin's own church", async () => {
    expect(await (await DELETE()).json()).toEqual({ intake: null, connectionId: "c1" });
    expect(intakeStore.deleteIntakeSettings).toHaveBeenCalledWith("org-1");
  });
});

describe("/api/admin/church-records/intake/destinations", () => {
  it("lists through the write key and names a refusal", async () => {
    stubIntake.destinations.mockResolvedValue([{ id: "42", name: "New people" }]);
    expect(await (await destinations({ key: WRITE_KEY })).json()).toEqual({ destinations: [{ id: "42", name: "New people" }] });
    expect(stubIntake.destinations).toHaveBeenCalledWith({ baseUrl: CONNECTION.baseUrl, key: WRITE_KEY });

    stubIntake.destinations.mockRejectedValue(new RecordsError("unauthorized", 401));
    const refused = await destinations({ key: WRITE_KEY });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain("didn't accept the write key");
  });

  it("never lists through the read key", async () => {
    expect((await destinations({ key: READ_KEY })).status).toBe(400);
    expect(stubIntake.destinations).not.toHaveBeenCalled();
  });
});
