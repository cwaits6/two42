import { CHILD_INVITE_REFUSED } from "@/lib/household";

/**
 * Above the optional fields of a form whose answers reach the directory.
 * `notShown` names the form's other fields that never reach it, so the notice stays true.
 */
export function DirectoryNotice({ notShown }: { notShown?: string }) {
  return (
    <p className="text-base text-muted-foreground">
      Everything you add here shows in the directory, except a birth year, which can only go into a phone contact someone saves.{" "}
      {notShown && `${notShown} `}
      Leave out anything you don&apos;t want shown.
    </p>
  );
}

/** Where a child is added: leaving them out is fine, and why no invite can follow. */
export function ChildListingNotice() {
  return (
    <p className="text-base text-muted-foreground">
      You don&apos;t have to list a child. Anyone you leave out stays out of the directory.{" "}
      {CHILD_INVITE_REFUSED}
    </p>
  );
}
