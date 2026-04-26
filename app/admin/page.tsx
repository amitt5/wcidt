import { createServiceClient } from "@/lib/supabase/server";
import type { ReviewQueueItem } from "@/lib/types";
import ReviewCard from "./ReviewCard";

export const revalidate = 0; // Always fresh for admin

export default async function AdminPage() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("review_queue")
    .select(`
      *,
      raw_messages (
        message_text,
        message_timestamp,
        group_jid,
        whatsapp_groups ( group_name, city, organizer_name )
      )
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const items = (data as ReviewQueueItem[]) ?? [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Review queue</h2>
        <span className="text-sm text-gray-400">{items.length} pending</span>
      </div>

      {error && (
        <p className="text-sm text-red-500 mb-4">Failed to load queue.</p>
      )}

      {items.length === 0 && !error && (
        <p className="text-center py-16 text-gray-400">All clear — nothing to review.</p>
      )}

      <div className="space-y-4">
        {items.map((item) => (
          <ReviewCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
