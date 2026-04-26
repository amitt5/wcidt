export type DanceEvent = {
  id: string;
  source_message_id: string | null;
  title: string;
  city: string;
  venue: string | null;
  event_date: string;       // YYYY-MM-DD
  start_time: string | null; // HH:MM:SS
  end_time: string | null;
  dance_styles: string[];
  description: string | null;
  organizer_name: string | null;
  status: "active" | "cancelled" | "rescheduled";
  confidence: number;
  published: boolean;
  created_at: string;
  updated_at: string;
};

export type ReviewQueueItem = {
  id: string;
  raw_message_id: string;
  extracted_data: {
    event_type: "new_event" | "cancellation" | "reschedule" | "noise";
    title: string | null;
    date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue: string | null;
    dance_styles: string[];
    confidence: number;
    notes: string | null;
  };
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  raw_messages: {
    message_text: string;
    message_timestamp: string;
    group_jid: string;
    whatsapp_groups: {
      group_name: string;
      city: string;
      organizer_name: string | null;
    };
  };
};
