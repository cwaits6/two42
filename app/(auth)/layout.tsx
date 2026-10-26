/**
 * Auth route-group layout — intentionally minimal. The root layout still
 * wraps these pages in the global Header and Footer; AuthShell supplies the
 * two-column body between them.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
