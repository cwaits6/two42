import { PageHeader } from "@/components/layout/PageHeader";
import { greeting, todayLabel } from "@/lib/groups/greeting";

/** Home's page heading, shared by the group dashboard and the launcher. */
export function HomeGreeting({ name, timeZone }: { name: string | null; timeZone: string }) {
  return (
    <PageHeader
      title={
        name ? (
          <>
            {greeting(timeZone)}, <span className="text-brand-primary-text">{name}</span>.
          </>
        ) : (
          `${greeting(timeZone)}.`
        )
      }
      subtitle={todayLabel(timeZone)}
    />
  );
}
