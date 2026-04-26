import { createServiceClient } from "@/lib/supabase/server";
import type { DanceEvent } from "@/lib/types";

export const revalidate = 300; // refresh every 5 minutes

const STYLE_COLORS: Record<string, string> = {
  salsa: "bg-red-100 text-red-700",
  bachata: "bg-pink-100 text-pink-700",
  zouk: "bg-purple-100 text-purple-700",
  kizomba: "bg-orange-100 text-orange-700",
  tango: "bg-amber-100 text-amber-700",
};

function StyleTag({ style }: { style: string }) {
  const cls = STYLE_COLORS[style] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${cls}`}>
      {style}
    </span>
  );
}

function formatTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 || 12;
  return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
}

function formatDate(dateStr: string): string {
  // Parse as noon UTC to avoid timezone drift
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function groupByDate(events: DanceEvent[]): Map<string, DanceEvent[]> {
  const map = new Map<string, DanceEvent[]>();
  for (const e of events) {
    const list = map.get(e.event_date) ?? [];
    list.push(e);
    map.set(e.event_date, list);
  }
  return map;
}

export default async function HomePage() {
  const supabase = createServiceClient();

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("published", true)
    .eq("status", "active")
    .gte("event_date", todayStr)
    .lte("event_date", nextWeekStr)
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true });

  const grouped = groupByDate((data as DanceEvent[]) ?? []);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-5">
        <div className="max-w-xl mx-auto">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Where Can I Dance Tonight?
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Amsterdam · this week · salsa · bachata · zouk · kizomba · tango
          </p>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-8">
        {error && (
          <p className="text-sm text-red-500">Could not load events. Try refreshing.</p>
        )}

        {grouped.size === 0 && !error && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">No events found this week.</p>
            <p className="text-sm mt-1">Check back soon — we&apos;re listening.</p>
          </div>
        )}

        {[...grouped.entries()].map(([date, dayEvents]) => (
          <section key={date}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
              {formatDate(date)}
            </h2>
            <div className="space-y-3">
              {dayEvents.map((event) => {
                const startFmt = formatTime(event.start_time);
                const endFmt = formatTime(event.end_time);
                const timeStr = startFmt
                  ? endFmt
                    ? `${startFmt} – ${endFmt}`
                    : startFmt
                  : null;

                return (
                  <div
                    key={event.id}
                    className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 leading-tight">{event.title}</p>
                        {event.venue && (
                          <p className="text-sm text-gray-500 mt-0.5">{event.venue}</p>
                        )}
                        {event.description && (
                          <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                            {event.description}
                          </p>
                        )}
                      </div>
                      {timeStr && (
                        <span className="shrink-0 text-sm font-medium text-gray-700 whitespace-nowrap">
                          {timeStr}
                        </span>
                      )}
                    </div>
                    {event.dance_styles.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {event.dance_styles.map((s) => (
                          <StyleTag key={s} style={s} />
                        ))}
                      </div>
                    )}
                    {event.organizer_name && (
                      <p className="mt-2 text-xs text-gray-400">by {event.organizer_name}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <footer className="max-w-xl mx-auto px-4 pb-8 text-xs text-center text-gray-300">
        wherecanIdancetonight.com · Amsterdam
      </footer>
    </main>
  );
}
