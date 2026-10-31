import { CalendarPage } from "@/components/events/CalendarPage";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Calendar");

// The org-level calendar: every group the member belongs to, each in its
// own color. The no-group redirect lives in the layout.
export default function OrgCalendarPage() {
  return <CalendarPage />;
}
