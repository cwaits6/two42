import { pageTitle } from "@/lib/pageTitle";
import { SetupAccountForm } from "./SetupAccountForm";

export const generateMetadata = () => pageTitle("Set up your account");

export default function SetupAccountPage() {
  return <SetupAccountForm />;
}
