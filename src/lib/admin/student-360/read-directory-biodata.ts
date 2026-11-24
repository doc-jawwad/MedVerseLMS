import type { createClient } from "@/lib/supabase/server";

type DirectoryBiodata = {
  email: string | null;
  college_name: string | null;
  last_login_at: string | null;
};

/** Read only for IDs already returned by the caller's RLS-scoped list. */
export async function readDirectoryBiodata(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
) {
  const biodata = new Map<string, DirectoryBiodata>();
  const batchSize = 12;
  for (let start = 0; start < ids.length; start += batchSize) {
    await Promise.all(ids.slice(start, start + batchSize).map(async (id) => {
      const { data, error } = await supabase.rpc("admin_student_profile", {
        p_student_id: id,
      });
      const profile = (data as { profile?: DirectoryBiodata } | null)?.profile;
      if (!error && profile) {
        biodata.set(id, {
          email: profile.email,
          college_name: profile.college_name,
          last_login_at: profile.last_login_at,
        });
      }
    }));
  }
  return biodata;
}
