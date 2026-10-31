import { pageTitle } from "@/lib/pageTitle";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const generateMetadata = () => pageTitle("Reset your password");

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
