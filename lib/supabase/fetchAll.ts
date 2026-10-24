export const PAGE_SIZE = 1000;

interface Page<T, E> {
  data: T[] | null;
  error: E | null;
}

/**
 * PostgREST truncates a response at the API's max_rows (1,000 by default)
 * with no error, so any read that can outgrow it must page. `page` builds
 * the query for one `.range(from, to)` window and must carry a unique,
 * stable `.order(...)`, or rows can repeat or vanish between pages.
 */
export async function fetchAll<T, E>(
  page: (from: number, to: number) => PromiseLike<Page<T, E>>,
  pageSize: number = PAGE_SIZE,
): Promise<Page<T, E>> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return { data: rows, error: null };
  }
}
