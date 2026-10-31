interface ListRead<T> {
  data: T[] | null;
  error: { code?: string; message: string } | null;
}

/**
 * A page's list read, split three ways: rows, an empty list, or null when the
 * read failed. Render ErrorState on null and EmptyState only on an empty list,
 * so a failed read never reads as "nothing here yet".
 */
export function readList<T>({ data, error }: ListRead<T>, what: string): T[] | null {
  if (error) {
    // code/message only: a PostgrestError's details/hint echo row content.
    console.error("Failed to load %s: code=%s message=%s", what, error.code, error.message);
    return null;
  }
  return data ?? [];
}
