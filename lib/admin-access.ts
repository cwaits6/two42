// content_editor may reach the admin overview only; content moved under
// each group's settings, where leadership is the gate.
export const CONTENT_EDITOR_ADMIN_PATHS = ["/admin"];

export function isContentEditorAllowed(pathname: string): boolean {
  return CONTENT_EDITOR_ADMIN_PATHS.some(
    (p) => pathname === p || (p !== "/admin" && pathname.startsWith(p + "/"))
  );
}
