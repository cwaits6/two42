"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rotationDateStarts } from "@/lib/supperClub/dates";
import {
  FORMAT_HELP,
  FORMAT_LABELS,
  FORMAT_OPTIONS,
  isSupperFormat,
  isRepeatKind,
  LENGTH_OPTIONS,
  REPEAT_OPTIONS,
  WEEK_OF_MONTH_OPTIONS,
  WEEKDAY_OPTIONS,
} from "@/lib/supperClub/labels";
import { changeRotation, endsOnOf, settleTitle, MAX_LENGTH_MONTHS, type RotationValues } from "@/lib/supperClub/rotationValues";
import { failureMessage } from "@/lib/errorCopy";
import { groupPath } from "@/lib/groups/active";
import { createClient } from "@/lib/supabase/client";

type Errors = Partial<Record<keyof RotationValues, string>>;

function whole(value: string, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function check(v: RotationValues): Errors {
  const errors: Errors = {};
  if (!v.title.trim()) errors.title = "Enter a title.";
  if (!v.startsOn) errors.startsOn = "Choose a start date.";
  if (v.lengthMode === "months" && whole(v.lengthMonths, 1, MAX_LENGTH_MONTHS) === null) errors.lengthMonths = `Enter 1 to ${MAX_LENGTH_MONTHS} months.`;
  if (v.lengthMode === "end" && (!v.endsOn || v.endsOn < v.startsOn)) errors.endsOn = "Choose an end date after the start.";
  if (v.repeatKind === "weeks" && whole(v.repeatWeeks, 1, 12) === null) errors.repeatWeeks = "Enter 1 to 12 weeks.";
  if (!v.startTime) errors.startTime = "Choose a start time.";
  const min = whole(v.sizeMin, 2, 20);
  const max = whole(v.sizeMax, 2, 20);
  if (min === null) errors.sizeMin = "Enter 2 to 20 people.";
  if (max === null || (min !== null && max < min)) errors.sizeMax = "Enter 2 to 20, no fewer than the smallest.";
  if (!v.closesOn) errors.closesOn = "Choose when sign-ups close.";
  return errors;
}

function columns(v: RotationValues) {
  return {
    title: v.title.trim(),
    format: v.format,
    starts_on: v.startsOn,
    ends_on: endsOnOf(v),
    length_months: v.lengthMode === "months" ? Number(v.lengthMonths) : null,
    repeat_kind: v.repeatKind,
    repeat_weeks: v.repeatKind === "weeks" ? Number(v.repeatWeeks) : null,
    repeat_week_of_month: v.repeatKind === "monthly_weekday" ? Number(v.weekOfMonth) : null,
    weekday: Number(v.weekday),
    default_start_time: v.startTime,
    table_size_min: Number(v.sizeMin),
    table_size_max: Number(v.sizeMax),
    signup_closes_on: v.closesOn,
    allow_back_to_back_hosting: v.format === "new_tables" && v.backToBack,
    bring_list_enabled: v.bringList,
  };
}

const FIELD = "h-12 text-lg";

export function RotationForm({
  groupId,
  zone,
  rotationId,
  initial,
  locked = false,
  previousRotationId,
  takenTitles,
}: {
  groupId: string;
  zone: string;
  /** Set when editing. */
  rotationId?: string;
  initial: RotationValues;
  /** Published: the format, dates and table size stay as they are. */
  locked?: boolean;
  /** The ended rotation a new one starts from. */
  previousRotationId?: string;
  /** The group's other rotation titles, which a generated title avoids. */
  takenTitles: readonly string[];
}) {
  const router = useRouter();
  // Editing keeps the saved title whatever the dates do.
  const [draft, setDraft] = useState({ values: initial, titleFollowsDates: !rotationId });
  const values = draft.values;
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RotationValues>(key: K, value: RotationValues[K]) => {
    setDraft((d) => changeRotation(d, key, value, takenTitles));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const backHref = rotationId
    ? groupPath(groupId, `/supper-club/rotations/${rotationId}`)
    : groupPath(groupId, "/supper-club");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const settled = settleTitle(draft, takenTitles);
    setDraft(settled);
    const values = settled.values;
    const found = locked ? { title: check(values).title, closesOn: check(values).closesOn } : check(values);
    setErrors(found);
    const first = Object.entries(found).find(([, message]) => message)?.[0];
    if (first) {
      document.getElementById(`rotation-${first}`)?.focus();
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const row = columns(values);
    if (rotationId) {
      const { data, error } = await supabase
        .from("supper_rotations")
        .update(
          locked
            ? { title: row.title, signup_closes_on: row.signup_closes_on, bring_list_enabled: row.bring_list_enabled }
            : row
        )
        .eq("id", rotationId)
        .select("id");
      setSaving(false);
      if (error || !data?.length) return toast.error(failureMessage("save the rotation"));
      toast.success("Rotation saved.");
      router.push(backHref);
      router.refresh();
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("supper_rotations")
      .insert({ ...row, group_id: groupId, created_by: user?.id ?? null, previous_rotation_id: previousRotationId ?? null })
      .select("id")
      .single();
    if (error || !data) {
      setSaving(false);
      return toast.error(failureMessage("add the rotation"));
    }
    const starts = rotationDateStarts(row, zone);
    if (starts.length > 0) {
      const { data: added, error: datesError } = await supabase
        .from("supper_rotation_dates")
        .insert(starts.map((starts_at) => ({ rotation_id: data.id, group_id: groupId, starts_at })))
        .select("id");
      if (datesError || added?.length !== starts.length) toast.error("Rotation added, but its dates weren't. Add them on the next page.");
    }
    setSaving(false);
    toast.success("Rotation added.");
    router.push(groupPath(groupId, `/supper-club/rotations/${data.id}`));
    router.refresh();
  }

  const field = (key: keyof RotationValues) => ({ id: `rotation-${key}`, ...invalidFieldProps(`rotation-${key}`, errors[key]) });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-2">
            <Label htmlFor="rotation-title" className="text-lg">Title</Label>
            <Input {...field("title")} value={values.title} maxLength={80} className={FIELD} onChange={(e) => set("title", e.target.value)}
              onBlur={() => setDraft((d) => settleTitle(d, takenTitles))}
            />
            <FieldError fieldId="rotation-title" message={errors.title} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rotation-format" className="text-lg">Format</Label>
            <Select
              items={FORMAT_OPTIONS}
              value={values.format}
              disabled={locked}
              onValueChange={(next) => next && isSupperFormat(next) && set("format", next)}
            >
              <SelectTrigger id="rotation-format" className={`w-full ${FIELD}`}>
                <SelectValue>{FORMAT_LABELS[values.format]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-base text-muted-foreground">{FORMAT_HELP[values.format]}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rotation-startsOn" className="text-lg">Start date</Label>
              <Input {...field("startsOn")} type="date" disabled={locked} value={values.startsOn} className={FIELD} onChange={(e) => set("startsOn", e.target.value)} />
              <FieldError fieldId="rotation-startsOn" message={errors.startsOn} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rotation-lengthMode" className="text-lg">Length</Label>
              <Select
                items={LENGTH_OPTIONS}
                value={values.lengthMode}
                disabled={locked}
                onValueChange={(next) => (next === "months" || next === "end") && set("lengthMode", next)}
              >
                <SelectTrigger id="rotation-lengthMode" className={`w-full ${FIELD}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LENGTH_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {values.lengthMode === "months" ? (
            <div className="space-y-2">
              <Label htmlFor="rotation-lengthMonths" className="text-lg">Number of months</Label>
              <Input {...field("lengthMonths")} type="number" inputMode="numeric" min={1} max={MAX_LENGTH_MONTHS} disabled={locked} value={values.lengthMonths} className={`${FIELD} sm:w-40`} onChange={(e) => set("lengthMonths", e.target.value)} />
              <FieldError fieldId="rotation-lengthMonths" message={errors.lengthMonths} />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="rotation-endsOn" className="text-lg">End date</Label>
              <Input {...field("endsOn")} type="date" disabled={locked} value={values.endsOn} className={`${FIELD} sm:w-64`} onChange={(e) => set("endsOn", e.target.value)} />
              <FieldError fieldId="rotation-endsOn" message={errors.endsOn} />
            </div>
          )}

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rotation-repeatKind" className="text-lg">How often</Label>
              <Select
                items={REPEAT_OPTIONS}
                value={values.repeatKind}
                disabled={locked}
                onValueChange={(next) => next && isRepeatKind(next) && set("repeatKind", next)}
              >
                <SelectTrigger id="rotation-repeatKind" className={`w-full ${FIELD}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {values.repeatKind === "weeks" ? (
              <div className="space-y-2">
                <Label htmlFor="rotation-repeatWeeks" className="text-lg">Every how many weeks</Label>
                <Input {...field("repeatWeeks")} type="number" inputMode="numeric" min={1} max={12} disabled={locked} value={values.repeatWeeks} className={FIELD} onChange={(e) => set("repeatWeeks", e.target.value)} />
                <FieldError fieldId="rotation-repeatWeeks" message={errors.repeatWeeks} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="rotation-weekOfMonth" className="text-lg">Which week</Label>
                <Select items={WEEK_OF_MONTH_OPTIONS} value={values.weekOfMonth} disabled={locked} onValueChange={(next) => next && set("weekOfMonth", next)}>
                  <SelectTrigger id="rotation-weekOfMonth" className={`w-full ${FIELD}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEK_OF_MONTH_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rotation-weekday" className="text-lg">Day</Label>
              <Select items={WEEKDAY_OPTIONS} value={values.weekday} disabled={locked} onValueChange={(next) => next && set("weekday", next)}>
                <SelectTrigger id="rotation-weekday" className={`w-full ${FIELD}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rotation-startTime" className="text-lg">Start time</Label>
              <Input {...field("startTime")} type="time" disabled={locked} value={values.startTime} className={FIELD} onChange={(e) => set("startTime", e.target.value)} />
              <FieldError fieldId="rotation-startTime" message={errors.startTime} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <fieldset className="space-y-2">
            <legend className="text-lg font-medium">Table size</legend>
            <p className="text-base text-muted-foreground">How many people at a table, hosts included.</p>
            <div className="grid grid-cols-2 gap-4 sm:w-96">
              <div className="space-y-2">
                <Label htmlFor="rotation-sizeMin" className="text-base">Fewest</Label>
                <Input {...field("sizeMin")} type="number" inputMode="numeric" min={2} max={20} disabled={locked} value={values.sizeMin} className={FIELD} onChange={(e) => set("sizeMin", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rotation-sizeMax" className="text-base">Most</Label>
                <Input {...field("sizeMax")} type="number" inputMode="numeric" min={2} max={20} disabled={locked} value={values.sizeMax} className={FIELD} onChange={(e) => set("sizeMax", e.target.value)} />
              </div>
            </div>
            <FieldError fieldId="rotation-sizeMin" message={errors.sizeMin} />
            <FieldError fieldId="rotation-sizeMax" message={errors.sizeMax} />
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="rotation-closesOn" className="text-lg">Sign-ups close</Label>
            <Input {...field("closesOn")} type="date" value={values.closesOn} className={`${FIELD} sm:w-64`} onChange={(e) => set("closesOn", e.target.value)} />
            <FieldError fieldId="rotation-closesOn" message={errors.closesOn} />
          </div>

          <div className="space-y-1">
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox id="rotation-bringList" checked={values.bringList} onCheckedChange={(checked) => set("bringList", checked === true)} />
              <Label htmlFor="rotation-bringList" className="text-lg font-normal">
                Hosts say what each guest brings
              </Label>
            </div>
            <p className="text-base text-muted-foreground">Each guest sees what their party brings, and the reminder email says it.</p>
          </div>

          {values.format === "new_tables" && (
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox id="rotation-backToBack" checked={values.backToBack} disabled={locked} onCheckedChange={(checked) => set("backToBack", checked === true)} />
              <Label htmlFor="rotation-backToBack" className="text-lg font-normal">
                Let a host host two suppers in a row
              </Label>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? "Saving…" : rotationId ? "Save rotation" : "Add rotation"}
        </Button>
        <Button size="lg" variant="outline" nativeButton={false} render={<Link href={backHref} />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
