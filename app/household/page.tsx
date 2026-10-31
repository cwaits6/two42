import { redirect } from "next/navigation";
import { HOUSEHOLD_TAB } from "@/lib/profileTabs";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Household");

export default function HouseholdPage() {
  redirect(`/profile?tab=${HOUSEHOLD_TAB}`);
}
