import { createClient } from "@/lib/supabase/server";
export async function probe() {
  const supabase = await createClient();
  const { data } = await supabase
    .rpc("serving_signup_create", {
      _group_id: "x",
      _service_date: "y",
      _attendee_ids: ["z"],
    })
    .single();
  const t: 12345 = data;
  return t;
}
