import { pageTitle } from "@/lib/pageTitle";
import { HouseholdsManager } from "./HouseholdsManager";

export const generateMetadata = () => pageTitle("Manage households");

export default function HouseholdsPage() {
  return <HouseholdsManager />;
}
