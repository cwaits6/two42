import { CalendarPage } from "@/components/events/CalendarPage";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Calendar | ${siteConfig.name}` };

// The org-level calendar: every group the member belongs to, each in its
// own color. The no-group redirect lives in the layout.
export default function OrgCalendarPage() {
  return <CalendarPage />;
}
