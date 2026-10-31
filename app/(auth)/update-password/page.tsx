import { pageTitle } from "@/lib/pageTitle";
import { UpdatePasswordForm } from "./UpdatePasswordForm";

export const generateMetadata = () => pageTitle("Choose a new password");

export default function UpdatePasswordPage() {
  return <UpdatePasswordForm />;
}
