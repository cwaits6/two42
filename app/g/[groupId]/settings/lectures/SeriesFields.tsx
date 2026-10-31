"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import type { SeriesDraft, SeriesFieldErrors } from "./lessonDraft";

/** Name and teacher, shared by the series pages and the Add series dialog. */
export function SeriesFields({
  draft,
  errors,
  onChange,
  idPrefix = "",
}: {
  draft: SeriesDraft;
  errors: SeriesFieldErrors;
  onChange: (draft: SeriesDraft) => void;
  /** Keeps ids unique when the dialog opens over the lesson form. */
  idPrefix?: string;
}) {
  const nameId = `${idPrefix}name`;
  const teacherId = `${idPrefix}teacher`;
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={nameId} className="text-lg">
          Series name
        </Label>
        <Input
          id={nameId}
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className="text-lg py-6"
          {...invalidFieldProps(nameId, errors.name)}
        />
        <FieldError fieldId={nameId} message={errors.name} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={teacherId} className="text-lg">
          Teacher <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={teacherId}
          value={draft.teacher}
          onChange={(e) => onChange({ ...draft, teacher: e.target.value })}
          className="text-lg py-6"
        />
      </div>
    </>
  );
}
