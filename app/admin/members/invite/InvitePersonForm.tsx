"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  validateInvitePerson,
  type InvitePersonErrors,
  type InvitePersonField,
} from "@/lib/members/invite-form";

interface HouseholdOption {
  value: string;
  label: string;
}

const NO_HOUSEHOLD = "none";
const EMPTY_FORM = { email: "", firstName: "", lastName: "", householdId: NO_HOUSEHOLD };

export function InvitePersonForm({
  households,
}: {
  /** null when the household list failed to load. */
  households: HouseholdOption[] | null;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<InvitePersonErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const householdItems = [
    { value: NO_HOUSEHOLD, label: "No household" },
    ...(households ?? []),
  ];

  function update(field: InvitePersonField, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSentTo(null);

    const { input, errors: found } = validateInvitePerson({
      ...form,
      householdId: form.householdId === NO_HOUSEHOLD ? "" : form.householdId,
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSending(true);
    try {
      const res = await fetch("/api/admin/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSentTo(input.email);
        setForm(EMPTY_FORM);
        return;
      }
      if (data.fieldErrors) {
        setErrors(data.fieldErrors);
      } else {
        setFormError("Couldn't send the invite. Try again.");
      }
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {sentTo && (
        <p
          role="status"
          className="flex items-start gap-3 rounded-lg border border-brand-primary/20 bg-brand-bg-light p-4 text-lg text-brand-primary-text"
        >
          <CheckCircle2 className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
          Invite sent to {sentTo}.
        </p>
      )}

      <TextField
        id="invite-email"
        label="Email"
        type="email"
        autoComplete="off"
        value={form.email}
        error={errors.email}
        onChange={(v) => update("email", v)}
      />
      <TextField
        id="invite-first-name"
        label="First name"
        autoComplete="off"
        value={form.firstName}
        error={errors.firstName}
        onChange={(v) => update("firstName", v)}
      />
      <TextField
        id="invite-last-name"
        label="Last name"
        autoComplete="off"
        value={form.lastName}
        error={errors.lastName}
        onChange={(v) => update("lastName", v)}
      />

      <div className="space-y-2">
        <Label htmlFor="invite-household" className="text-lg">
          Household (optional)
        </Label>
        <Select
          items={householdItems}
          value={form.householdId}
          onValueChange={(v) => update("householdId", v ?? NO_HOUSEHOLD)}
          disabled={households === null}
        >
          <SelectTrigger
            id="invite-household"
            className="h-12 w-full text-base"
            aria-invalid={errors.householdId ? true : undefined}
            aria-describedby={errors.householdId ? "invite-household-error" : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {householdItems.map((h) => (
              <SelectItem key={h.value} value={h.value}>
                {h.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {households === null && (
          <p className="text-base text-muted-foreground">
            Couldn&apos;t load households. You can still send the invite and add a
            household later.
          </p>
        )}
        <FieldError id="invite-household-error" message={errors.householdId} />
      </div>

      {formError && (
        <p role="alert" className="text-lg text-destructive">
          {formError}
        </p>
      )}

      <Button type="submit" size="lg" className="text-lg" disabled={sending}>
        {sending ? "Sending…" : "Send invite"}
      </Button>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  error,
  onChange,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-lg">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="text-lg"
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-base text-destructive">
      {message}
    </p>
  );
}
