import type { LogLine } from "../_shared/log.ts";

export type LoggedLine = LogLine;

/** Runs `run`, absorbing a rejection, and returns the log lines it wrote, parsed. */
export async function logged(run: () => Promise<unknown>): Promise<LoggedLine[]> {
  const lines: LoggedLine[] = [];
  const original = console.log;
  console.log = (line: string) => void lines.push(JSON.parse(line));
  try {
    await run().catch(() => {});
  } finally {
    console.log = original;
  }
  return lines;
}
