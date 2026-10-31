"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { failureMessage, NETWORK_ERROR } from "@/lib/errorCopy";
import { Upload, Mail, AlertCircle, CheckCircle2 } from "lucide-react";

interface ParsedRow {
  name: string;
  email: string;
  status: "new" | "existing";
  selected: boolean;
}

// Auto-detect the email column from CSV headers (case-insensitive)
function detectEmailColumn(headers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase();
    if (h.includes("email") || h.includes("e-mail") || h === "mail") {
      return i;
    }
  }
  return -1;
}

// Auto-detect a name column from CSV headers
function detectNameColumn(headers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase();
    if (h.includes("name")) {
      return i;
    }
  }
  return 0; // fallback to first column
}

// Minimal CSV parser (no external dependency)
function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
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

  const supabase = createClient();

  async function processFile(file: File) {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Please upload a .csv file.");
      return;
    }

    setResult(null);
    setDetectionError(null);
    setRows([]);

    const text = await file.text();
    const parsed = parseCSV(text);

    if (parsed.length < 2) {
      setDetectionError("The CSV appears to be empty or has no data rows.");
      return;
    }

    const rawHeaders = parsed[0];
    setHeaders(rawHeaders);

    const emailIdx = detectEmailColumn(rawHeaders);
    if (emailIdx === -1) {
      setDetectionError(
        "Could not auto-detect an email column. Please ensure your CSV has a column named 'Email' or similar."
      );
      setEmailColIdx(-1);
      return;
    }
    setEmailColIdx(emailIdx);

    const nameIdx = detectNameColumn(rawHeaders);
    const dataRows = parsed.slice(1);

    // Extract name + email pairs
    const candidates = dataRows
      .map((row) => ({
        name: (row[nameIdx] || "").trim(),
        email: (row[emailIdx] || "").trim().toLowerCase(),
      }))
      .filter((r) => r.email && r.email.includes("@"));

    if (candidates.length === 0) {
      setDetectionError(
        "No valid email addresses found in the detected email column."
      );
      return;
    }

    // Query existing profiles by email to mark already-joined members
    const emails = candidates.map((c) => c.email);
    const { data: existingProfiles } = await supabase
      .from("profiles")
      .select("email")
      .in("email", emails);

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
    if (file) processFile(file);
  }

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

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
      toast.error("No members selected.");
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
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-brand-primary-text">
          Import members
        </h1>
        <p className="text-base text-muted-foreground mt-2">
          Upload a CSV from Instant Church Directory and send join invites to all.
        </p>
      </div>

      {/* Upload area */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-10 cursor-pointer transition-colors ${
              dragging
                ? "border-brand-primary bg-brand-bg-light"
                : "border-slate-200 hover:border-brand-primary hover:bg-slate-50"
            }`}
          >
            <Upload className="h-10 w-10 text-slate-400" />
            <div className="text-center">
              <p className="text-base font-medium text-slate-700">
                Drag and drop a CSV file here, or click to browse
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Accepts .csv files from Instant Church Directory or any CSV
                with an email column
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </CardContent>
      </Card>

      {/* Detection error */}
      {detectionError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 mb-6 text-red-700">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Could not parse CSV</p>
            <p className="text-sm mt-1">{detectionError}</p>
            {headers.length > 0 && (
              <p className="text-sm mt-2">
                Detected columns: {headers.join(", ")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
              <div>
                <p className="text-base font-semibold">
                  {rows.length} contact{rows.length !== 1 ? "s" : ""} found
                  {" — "}
                  <span className="text-brand-primary-text">{newCount} new</span>
                  {rows.length - newCount > 0 && (
                    <span className="text-muted-foreground">
                      , {rows.length - newCount} already joined
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  Email column detected:{" "}
                  <strong>{headers[emailColIdx]}</strong>
                </p>
              </div>
              <Button
                onClick={handleSendInvites}
                disabled={sending || selectedCount === 0}
              >
                <Mail className="mr-2 h-4 w-4" />
                {sending ? "Sending..." : `Send Invites (${selectedCount})`}
              </Button>
            </div>

            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="px-3 py-2 w-10 text-left font-medium text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={allNewSelected}
                        onChange={(e) => toggleAll(e.target.checked)}
                        aria-label="Select all new members"
                        className="rounded"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      Name
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      Email
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      key={row.email}
                      className={`border-b last:border-0 ${
                        row.status === "existing"
                          ? "opacity-50 bg-slate-50"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={() => toggleRow(idx)}
                          disabled={row.status === "existing"}
                          aria-label={`Select ${row.email}`}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {row.name || (
                          <span className="text-muted-foreground italic">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono">{row.email}</td>
                      <td className="px-3 py-2">
                        {row.status === "existing" ? (
                          <Badge variant="secondary">Already a member</Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-brand-primary/30 text-brand-primary-text bg-brand-bg-light"
                          >
                            New
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result summary */}
      {result && (
        <div className="flex items-start gap-3 rounded-lg border border-brand-primary/20 bg-brand-bg-light p-4 text-brand-primary-text">
          <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              Invites sent to {result.sent} member
              {result.sent !== 1 ? "s" : ""}
            </p>
            {result.skipped > 0 && (
              <p className="text-sm mt-1">
                {result.skipped} skipped (already joined or previously invited)
              </p>
            )}
            {result.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-sm font-medium text-red-700">
                  {result.errors.length} error
                  {result.errors.length !== 1 ? "s" : ""}:
                </p>
                <ul className="text-sm text-red-600 mt-1 space-y-0.5 list-disc list-inside">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
