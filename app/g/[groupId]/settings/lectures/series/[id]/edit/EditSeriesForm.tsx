"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { groupPath } from "@/lib/groups/active";
import { PostingTo } from "@/components/groups/PostingTo";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

type LectureSeries = {
  id: string;
  name: string;
  teacher: string | null;
  is_archived: boolean;
};

export function EditSeriesForm({
  groupId,
  groupName,
  seriesId,
}: {
  groupId: string;
  groupName: string;
  seriesId: string;
}) {
  const [series, setSeries] = useState<LectureSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "not-found">(
    "loading",
  );
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const listHref = groupPath(groupId, "/settings/lectures/series");

  useEffect(() => {
    supabase
      .from("lecture_series")
      .select("id, name, teacher, is_archived")
      .eq("id", seriesId)
      .eq("group_id", groupId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          setLoadState("not-found");
          return;
        }
        setSeries(data as LectureSeries);
        setIsArchived((data as LectureSeries).is_archived);
        setLoadState("ready");
      });
  }, [seriesId, groupId, supabase]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    const { data, error } = await supabase
      .from("lecture_series")
      .update({
        name: formData.get("name") as string,
        teacher: (formData.get("teacher") as string) || null,
        is_archived: isArchived,
      })
      .eq("id", seriesId)
      .eq("group_id", groupId)
      .select("id");

    setLoading(false);

    if (error || !data?.length) {
      toast.error("Failed to update series.");
      return;
    }

    toast.success("Series updated!");
    router.push(listHref);
  };

  const handleDelete = async () => {
    const { data, error } = await supabase
      .from("lecture_series")
      .delete()
      .eq("id", seriesId)
      .eq("group_id", groupId)
      .select("id");

    if (error || !data?.length) {
      toast.error("Failed to delete series.");
      return;
    }

    toast.success("Series deleted.");
    router.push(listHref);
  };

  if (loadState === "loading") {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-xl text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (loadState === "not-found" || !series) {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-xl text-muted-foreground">
          Series not found.{" "}
          <Link
            href={listHref}
            className="text-brand-primary-text hover:underline"
          >
            Back to series
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary-text">Edit Series</CardTitle>
          <PostingTo groupName={groupName} />
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-lg">Series Name</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={series.name}
                className="text-lg py-6"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="teacher" className="text-lg">Teacher</Label>
              <Input
                id="teacher"
                name="teacher"
                defaultValue={series.teacher ?? ""}
                className="text-lg py-6"
              />
            </div>

            <div className="flex items-center gap-3 pt-2 pb-2">
              <Switch
                id="is_archived"
                checked={isArchived}
                onCheckedChange={setIsArchived}
              />
              <div>
                <Label htmlFor="is_archived" className="text-base font-medium">Archive this series</Label>
                <p className="text-sm text-muted-foreground">Moves it to the Past Series section on the lectures page</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                type="submit"
                size="lg"
                className="flex-1 text-lg py-6"
                disabled={loading}
              >
                {loading ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="destructive"
                className="text-lg py-6"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete this series?"
        description="Lectures in it stay, but are no longer grouped together."
        confirmLabel="Delete series"
        pendingLabel="Deleting…"
        onConfirm={handleDelete}
      />
    </div>
  );
}
