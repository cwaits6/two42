"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { groupPath } from "@/lib/groups/active";
import { PostingTo } from "@/components/groups/PostingTo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function NewSeriesForm({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    const { error } = await supabase.from("lecture_series").insert({
      group_id: groupId,
      name: formData.get("name") as string,
      teacher: (formData.get("teacher") as string) || null,
    });

    setLoading(false);

    if (error) {
      toast.error("Failed to create series.");
      return;
    }

    toast.success("Series created.");
    router.push(groupPath(groupId, "/settings/lectures/series"));
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary-text">New Lecture Series</CardTitle>
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
                className="text-lg py-6"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="teacher" className="text-lg">Teacher</Label>
              <Input
                id="teacher"
                name="teacher"
                className="text-lg py-6"
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full text-lg py-6"
              disabled={loading}
            >
              {loading ? "Creating..." : "Create Series"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
