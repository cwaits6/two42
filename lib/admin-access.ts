// content_editor may reach the admin overview plus the About Page editor;
// every other /admin/* path stays admin-only.
export const CONTENT_EDITOR_ADMIN_PATHS = ["/admin", "/admin/about"];

export function isContentEditorAllowed(pathname: string): boolean {
  return CONTENT_EDITOR_ADMIN_PATHS.some(
    (p) => pathname === p || (p !== "/admin" && pathname.startsWith(p + "/"))
  );
}
