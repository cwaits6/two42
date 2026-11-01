import { pageTitle } from "@/lib/pageTitle";
import { HouseholdsManager } from "./HouseholdsManager";

export const generateMetadata = () => pageTitle("Households");

export default function HouseholdsPage() {
  return <HouseholdsManager />;
}
