import { CHILD_INVITE_REFUSED } from "@/lib/household";

/** Above the optional fields of a form whose answers reach the directory. */
export function DirectoryNotice() {
  return (
    <p className="text-base text-muted-foreground">
      Everything you add here shows in the directory, except a birth year. Leave out anything you don&apos;t want shown.
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
