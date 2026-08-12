"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mintSignedUrl, mintSignedUrls } from "@/lib/uploadImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BlockEditor } from "@/components/editor";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, X } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { displayName, initials } from "@/lib/names";
import type { Block, PartialBlock } from "@blocknote/core";
import type { ClassTeacherWithProfile } from "@/lib/types";

type MemberOption = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
};

interface AboutEditorProps {
  initialBody: string;
  initialTeachers: ClassTeacherWithProfile[];
}

const TEACHER_SELECT =
  "*, profiles(id, first_name, last_name, preferred_name, avatar_url)";

export function AboutEditor({ initialBody, initialTeachers }: AboutEditorProps) {
  const supabase = useMemo(() => createClient(), []);

  // --- Class summary ---
  const blocksRef = useRef<Block[]>([]);
  const isDirtyRef = useRef(false);
  const [savingSummary, setSavingSummary] = useState(false);

  const parsedInitialContent = (): PartialBlock[] | undefined => {
    if (!initialBody) return undefined;
    try {
      const parsed = JSON.parse(initialBody);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  };

  const handleSaveSummary = async () => {
    setSavingSummary(true);
    // If the editor was never touched, preserve the existing body instead of
    // overwriting it with []
    const body = isDirtyRef.current
      ? JSON.stringify(blocksRef.current)
      : initialBody || "[]";

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("about_page").upsert({
      id: true,
      body,
      updated_by: user?.id,
      updated_at: new Date().toISOString(),
    });

    setSavingSummary(false);
    if (error) {
      toast.error("Failed to save the class summary.");
      return;
    }
    toast.success("Class summary saved.");
    isDirtyRef.current = false;
  };

  // --- Teachers ---
  const [teachers, setTeachers] = useState(initialTeachers);
  const [addOpen, setAddOpen] = useState(false);
  const [candidates, setCandidates] = useState<MemberOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ClassTeacherWithProfile | null>(null);
  const [busy, setBusy] = useState(false);

  const openAdd = async () => {
    setQuery("");
    setAddOpen(true);
    if (candidates) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, preferred_name, avatar_url")
      .in("role", ["member", "content_editor", "admin"])
      .order("last_name")
      .order("first_name");
    if (error) {
      toast.error("Failed to load members.");
      setAddOpen(false);
      return;
    }
    // Private buckets (CWA-59): exchange stored avatar URLs for signed URLs
    // before they reach the candidate-list AvatarImage renders.
    const rows = (data ?? []) as MemberOption[];
    const signed = await mintSignedUrls(rows.map((r) => r.avatar_url));
    setCandidates(rows.map((r, i) => ({ ...r, avatar_url: signed[i] })));
  };

  const visibleCandidates = useMemo(() => {
    if (!candidates) return [];
    const taken = new Set(teachers.map((t) => t.profile_id));
    const available = candidates.filter((c) => !taken.has(c.id));
    if (!query.trim()) return available;
    const q = query.trim().toLowerCase();
    return available.filter((c) =>
      [c.first_name, c.last_name, c.preferred_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [candidates, teachers, query]);

  const handleAdd = async (member: MemberOption) => {
    setBusy(true);
    const nextOrder =
      teachers.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1;
    const { data, error } = await supabase
      .from("class_teachers")
      .insert({ profile_id: member.id, sort_order: nextOrder })
      .select(TEACHER_SELECT)
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("Failed to add teacher.");
      return;
    }
    const added = data as ClassTeacherWithProfile;
    // The insert re-selects the raw stored URL — re-sign it for display.
    // The candidate row's avatar_url is already signed, so reuse it first.
    if (added.profiles) {
      added.profiles = {
        ...added.profiles,
        avatar_url:
          member.avatar_url ?? (await mintSignedUrl(added.profiles.avatar_url)),
      };
    }
    setTeachers((prev) => [...prev, added]);
    setAddOpen(false);
    // Go straight to the bio form so the new entry doesn't sit empty
    setEditing(added);
  };

  const handleRemove = async (teacher: ClassTeacherWithProfile) => {
    if (
      !confirm(
        `Remove ${displayName(teacher.profiles)} from the About page?`,
      )
    )
      return;
    const { error } = await supabase
      .from("class_teachers")
      .delete()
      .eq("id", teacher.id);
    if (error) {
      toast.error("Failed to remove teacher.");
      return;
    }
    setTeachers((prev) => prev.filter((t) => t.id !== teacher.id));
    toast.success("Teacher removed.");
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= teachers.length) return;
    setBusy(true);
    const a = teachers[index];
    const b = teachers[target];
    // Swap sort_order values; fall back to indexes if they were equal
    const aOrder = a.sort_order === b.sort_order ? target : b.sort_order;
    const bOrder = a.sort_order === b.sort_order ? index : a.sort_order;
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("class_teachers").update({ sort_order: aOrder }).eq("id", a.id),
      supabase.from("class_teachers").update({ sort_order: bOrder }).eq("id", b.id),
    ]);
    setBusy(false);
    if (e1 || e2) {
      toast.error("Failed to reorder teachers.");
      return;
    }
    setTeachers((prev) => {
      const next = [...prev];
      next[index] = { ...b, sort_order: bOrder };
      next[target] = { ...a, sort_order: aOrder };
      return next;
    });
  };

  const handleSaveTeacher = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    const formData = new FormData(e.currentTarget);
    const title = (formData.get("title") as string).trim() || "Teacher";
    const bio = (formData.get("bio") as string).trim();
    const { error } = await supabase
      .from("class_teachers")
      .update({ title, bio })
      .eq("id", editing.id);
    setBusy(false);
    if (error) {
      toast.error("Failed to save teacher.");
      return;
    }
    setTeachers((prev) =>
      prev.map((t) => (t.id === editing.id ? { ...t, title, bio } : t)),
    );
    setEditing(null);
    toast.success("Teacher saved.");
  };

  return (
    <PageContainer size="default" className="space-y-8">
      <PageHeader
        title="About Page"
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/about" />}>
            View page
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary">
            Class Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg overflow-hidden border border-border">
            <BlockEditor
              initialContent={parsedInitialContent()}
              onChange={(blocks) => {
                blocksRef.current = blocks;
                isDirtyRef.current = true;
              }}
            />
          </div>
          <Button
            onClick={handleSaveSummary}
            disabled={savingSummary}
            className="bg-brand-primary hover:bg-brand-primary/90 text-white"
          >
            {savingSummary ? "Saving..." : "Save Summary"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl text-brand-primary">
              Teachers
            </CardTitle>
            <Button
              size="sm"
              onClick={openAdd}
              className="bg-brand-primary hover:bg-brand-primary/90 text-white"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add teacher
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {teachers.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center">
              No teachers yet. Use &ldquo;Add teacher&rdquo; to pick a member.
            </p>
          ) : (
            <div className="divide-y">
              {teachers.map((teacher, index) => (
                <div key={teacher.id} className="flex items-center gap-3 py-3">
                  <Avatar className="h-10 w-10 shrink-0">
                    {teacher.profiles?.avatar_url && (
                      <AvatarImage
                        src={teacher.profiles.avatar_url}
                        alt={displayName(teacher.profiles)}
                      />
                    )}
                    <AvatarFallback className="bg-brand-primary text-white text-sm">
                      {initials(teacher.profiles)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {displayName(teacher.profiles)}
                      <span className="ml-2 text-base font-medium uppercase tracking-wider text-muted-foreground">
                        {teacher.title}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {teacher.bio || "No bio yet."}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy || index === 0}
                    onClick={() => handleMove(index, -1)}
                    aria-label={`Move ${displayName(teacher.profiles)} up`}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy || index === teachers.length - 1}
                    onClick={() => handleMove(index, 1)}
                    aria-label={`Move ${displayName(teacher.profiles)} down`}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    onClick={() => setEditing(teacher)}
                    aria-label={`Edit ${displayName(teacher.profiles)}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    onClick={() => handleRemove(teacher)}
                    aria-label={`Remove ${displayName(teacher.profiles)}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add teacher</DialogTitle>
          </DialogHeader>
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search members..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="overflow-y-auto flex-1 -mx-1 px-1">
            {!candidates ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Loading members...
              </p>
            ) : visibleCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {query.trim()
                  ? "No one matches your search."
                  : "Everyone is already listed as a teacher."}
              </p>
            ) : (
              <div className="divide-y">
                {visibleCandidates.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 py-2.5">
                    <Avatar className="h-8 w-8 shrink-0">
                      {member.avatar_url && (
                        <AvatarImage
                          src={member.avatar_url}
                          alt={displayName(member)}
                        />
                      )}
                      <AvatarFallback className="bg-brand-primary text-white text-xs">
                        {initials(member)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">
                      {displayName(member)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleAdd(member)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? displayName(editing.profiles) : ""}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleSaveTeacher} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="teacher-title">Title</Label>
                <Input
                  id="teacher-title"
                  name="title"
                  defaultValue={editing.title}
                  placeholder="Teacher"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="teacher-bio">Bio</Label>
                <Textarea
                  id="teacher-bio"
                  name="bio"
                  rows={6}
                  defaultValue={editing.bio}
                  placeholder="A few sentences about this teacher."
                />
              </div>
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy}
                  className="bg-brand-primary hover:bg-brand-primary/90 text-white"
                >
                  {busy ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
