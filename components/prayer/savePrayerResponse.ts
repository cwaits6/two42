import { createClient } from "@/lib/supabase/client";

/** Say or take back that this person is praying for a request. */
export async function savePrayerResponse(input: {
  requestId: string;
  profileId: string;
  groupId: string;
  praying: boolean;
}) {
  const { requestId, profileId, groupId, praying } = input;
  const supabase = createClient();
  return praying
    ? await supabase
        .from("prayer_responses")
        .insert({ request_id: requestId, profile_id: profileId, group_id: groupId })
    : await supabase
        .from("prayer_responses")
        .delete()
        .eq("request_id", requestId)
        .eq("group_id", groupId)
        .eq("profile_id", profileId);
}
