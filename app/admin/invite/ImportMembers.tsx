"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { failureMessage, NETWORK_ERROR } from "@/lib/errorCopy";
import { Upload, Mail, AlertCircle, CheckCircle2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { detectEmailColumn, detectNameColumn, importCandidates, parseCSV } from "./csv";

interface ParsedRow {
  name: string;
  email: string;
  status: "new" | "existing";
  selected: boolean;
}

export function ImportMembers() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [emailColIdx, setEmailColIdx] = useState<number>(-1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    sent: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const supabase = useMemo(() => createClient(), []);

  async function processFile(file: File) {
    setResult(null);
    setDetectionError(null);
    setHeaders([]);
    setRows([]);

    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setDetectionError("Choose a file that ends in .csv.");
      return;
    }

    const text = await file.text();
    const parsed = parseCSV(text);

    if (parsed.length < 2) {
      setDetectionError("This file has no rows to import. Add at least one row under the column names.");
      return;
    }

    const rawHeaders = parsed[0];
    setHeaders(rawHeaders);

    const emailIdx = detectEmailColumn(rawHeaders);
    if (emailIdx === -1) {
      setDetectionError(
        "Couldn't find an email column. Name one column Email, then choose the file again."
      );
      setEmailColIdx(-1);
      return;
    }
    setEmailColIdx(emailIdx);

    const nameIdx = detectNameColumn(rawHeaders);
    const dataRows = parsed.slice(1);

    // Extract name + email pairs
    const candidates = importCandidates(dataRows, nameIdx, emailIdx);

    if (candidates.length === 0) {
      setDetectionError(
        "Couldn't find any email addresses in the email column. Check the file, then choose it again."
      );
      return;
    }

    // Query existing profiles by email to mark already-joined members
    const emails = candidates.map((c) => c.email);
    const { data: existingProfiles, error: existingError } = await supabase
      .from("profiles")
      .select("email")
      .in("email", emails);
    if (existingError) {
      console.error("Import members: failed to check existing members:", existingError.code);
      setDetectionError("Couldn't check who has already joined. Choose the file again.");
      return;
    }

    const existingSet = new Set(
      (existingProfiles || [])
        .map((p: { email: string | null }) => p.email?.toLowerCase())
        .filter(Boolean)
    );

    // Sort: new members first, existing last
    const parsedRows: ParsedRow[] = candidates
      .map((c) => ({
        name: c.name,
        email: c.email,
        status: existingSet.has(c.email)
          ? ("existing" as const)
          : ("new" as const),
        selected: !existingSet.has(c.email),
      }))
      .sort((a, b) => {
        if (a.status === b.status) return a.email.localeCompare(b.email);
        return a.status === "new" ? -1 : 1;
      });

    setRows(parsedRows);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared so choosing the same file again after fixing it fires a change.
    e.target.value = "";
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function toggleRow(idx: number) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, selected: !r.selected } : r))
    );
  }

  function toggleAll(checked: boolean) {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        selected: r.status === "new" ? checked : false,
      }))
    );
  }

  async function handleSendInvites() {
    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) {
      toast.error("Select at least one member to invite.");
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const res = await fetch("/api/admin/invite-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: selected.map((r) => r.email) }),
      });

      if (!res.ok) {
        toast.error(failureMessage("send the invites", res.status));
        return;
      }

      const data = await res.json();

      setResult(data);

      if (data.sent > 0) {
        toast.success(
          `Invites sent to ${data.sent} member${data.sent !== 1 ? "s" : ""}.`
        );
      } else {
        toast.info("No new invites were sent.");
      }
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setSending(false);
    }
  }

  const selectedCount = rows.filter((r) => r.selected).length;
  const newCount = rows.filter((r) => r.status === "new").length;
  const allNewSelected =
    newCount > 0 &&
    rows.filter((r) => r.status === "new").every((r) => r.selected);

  return (
    <PageContainer>
      <PageHeader
        title="Import members"
        subtitle="Upload a CSV with an email column and send each new member an invite to join."
      />

      <Card className="mb-6">
        <CardContent>
          {/* A native button: Tab reaches it, and Enter or Space opens the file picker. */}
          <button
            type="button"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
              dragging
                ? "border-brand-primary bg-brand-warm"
                : "border-border hover:border-brand-primary hover:bg-brand-warm/50"
            }`}
          >
            <Upload className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <span className="text-center">
              <span className="block text-lg font-medium text-foreground">Choose a CSV file</span>
              <span className="mt-1 block text-base text-muted-foreground">
                Or drag and drop it here. It needs a column named Email.
              </span>
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileChange}
            aria-hidden="true"
            tabIndex={-1}
          />
        </CardContent>
      </Card>

      {detectionError && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-card p-4"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="text-lg font-medium text-foreground">Couldn&apos;t read this file.</p>
            <p className="mt-1 text-base text-foreground">{detectionError}</p>
            {headers.length > 0 && (
              <p className="mt-2 text-base text-muted-foreground">
                Columns in this file: {headers.join(", ")}
              </p>
            )}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <Card className="mb-6">
          <CardContent>
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg font-semibold">
                  {rows.length} {rows.length === 1 ? "contact" : "contacts"} found:{" "}
                  <span className="text-brand-primary-text">{newCount} new</span>
                  {rows.length - newCount > 0 && (
                    <span className="text-muted-foreground">
                      , {rows.length - newCount} already joined
                    </span>
                  )}
                </p>
                <p className="text-base text-muted-foreground">
                  Email column: <strong>{headers[emailColIdx]}</strong>
                </p>
              </div>
              <Button onClick={handleSendInvites} disabled={sending || selectedCount === 0}>
                <Mail aria-hidden="true" />
                {sending
                  ? "Sending…"
                  : `Send ${selectedCount} ${selectedCount === 1 ? "invite" : "invites"}`}
              </Button>
            </div>

            <div className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2">
              <Checkbox
                id="import-select-all"
                checked={allNewSelected}
                onCheckedChange={(checked) => toggleAll(checked)}
              />
              <label htmlFor="import-select-all" className="text-base font-medium">
                Select all new members
              </label>
            </div>
            <ul className="divide-y divide-border">
              {rows.map((row, idx) => (
                <li key={row.email} className="flex items-center gap-3 px-3 py-3">
                  <Checkbox
                    id={`import-row-${idx}`}
                    checked={row.selected}
                    disabled={row.status === "existing"}
                    onCheckedChange={() => toggleRow(idx)}
                    aria-label={`Select ${row.email}`}
                  />
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="min-w-0 max-w-full">
                      <p className="text-base font-medium">{row.name || row.email}</p>
                      {row.name && (
                        <p className="break-words text-base text-muted-foreground">{row.email}</p>
                      )}
                    </div>
                    {row.status === "existing" ? (
                      <Badge variant="secondary">Already a member</Badge>
                    ) : (
                      <Badge variant="outline">New</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {result && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-brand-primary/20 bg-brand-warm p-4"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-primary-text" aria-hidden="true" />
          <div>
            <p className="text-lg font-medium text-foreground">
              Invites sent to {result.sent} {result.sent === 1 ? "member" : "members"}.
            </p>
            {result.skipped > 0 && (
              <p className="mt-1 text-base text-foreground">
                {result.skipped} skipped because they already joined or were already invited.
              </p>
            )}
            {result.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-base font-medium text-destructive">
                  {result.errors.length} couldn&apos;t be sent:
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-base text-destructive">
                  {result.errors.map((e) => (
                    <li key={e} className="break-words">{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
