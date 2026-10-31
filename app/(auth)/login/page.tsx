import { pageTitle } from "@/lib/pageTitle";
import { LoginForm } from "./LoginForm";

export const generateMetadata = () => pageTitle("Sign in");

export default function LoginPage() {
  return <LoginForm />;
}
