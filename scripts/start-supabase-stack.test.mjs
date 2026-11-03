import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./start-supabase-stack.sh", import.meta.url));

// The failing line from the job's own logs, as the pinned CLI prints it.
const PORT_CLASH =
  'failed to start docker container "supabase_db_small-group-hub": Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint supabase_db_small-group-hub (31f0906271f73af34ce47a552fe9a3c9a5f67f4d4c121139e20334f5b1797741): failed to bind host port 0.0.0.0:54322/tcp: address already in use';
const OTHER_FAILURE = 'failed to pull docker image "public.ecr.aws/supabase/postgres": toomanyrequests';

let dir;

function stub(name, body) {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

/** Each attempt is `[exit status, output]`; a start beyond the list fails loudly. */
function run(attempts, { sudoStatus = 0 } = {}) {
  attempts.forEach(([status, output], i) => {
    writeFileSync(join(dir, `start-${i}.out`), `${output}\n`);
    writeFileSync(join(dir, `start-${i}.status`), String(status));
  });
  stub(
    "npx",
    `echo "npx $*" >> "$DIR/calls"
[ "$2" = start ] || exit 0
n=$(cat "$DIR/starts" 2>/dev/null || echo 0)
echo $((n + 1)) > "$DIR/starts"
cat "$DIR/start-$n.out" || exit 99
exit "$(cat "$DIR/start-$n.status")"`,
  );
  stub("sudo", `echo "sudo $*" >> "$DIR/calls"\nexit ${sudoStatus}`);
  const result = spawnSync(SCRIPT, ["-x", "studio,vector"], {
    encoding: "utf8",
    env: { ...process.env, DIR: dir, PATH: `${dir}:${process.env.PATH}` },
  });
  let calls = "";
  try {
    calls = readFileSync(join(dir, "calls"), "utf8");
  } catch {
    // no stubbed command ran
  }
  return { status: result.status, stdout: result.stdout, calls: calls.trim().split("\n") };
}

const START = "npx supabase start -x studio,vector";
const STOP = "npx supabase stop --no-backup";
const LISTENERS = "sudo ss -ltnp";
const SOCKETS = "sudo ss -tanp ( sport = :54322 or dport = :54322 )";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "start-supabase-stack-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("start-supabase-stack", () => {
  it("starts once when the first start succeeds", () => {
    const { status, calls } = run([[0, "Started supabase local development setup."]]);
    expect(status).toBe(0);
    expect(calls).toEqual([START]);
  });

  it("logs the port's holders, stops, and retries once on a port clash", () => {
    const { status, calls, stdout } = run([
      [1, PORT_CLASH],
      [0, "Started supabase local development setup."],
    ]);
    expect(status).toBe(0);
    expect(calls).toEqual([START, LISTENERS, SOCKETS, STOP, START]);
    expect(stdout).toContain(PORT_CLASH);
    expect(stdout).toContain("::warning::");
  });

  it("does not retry a second port clash, and fails with its status", () => {
    const { status, calls } = run([
      [1, PORT_CLASH],
      [4, PORT_CLASH],
    ]);
    expect(status).toBe(4);
    expect(calls).toEqual([START, LISTENERS, SOCKETS, STOP, START, LISTENERS, SOCKETS]);
  });

  it("stops the job with the original status on any other failure", () => {
    const { status, calls, stdout } = run([[3, OTHER_FAILURE]]);
    expect(status).toBe(3);
    expect(calls).toEqual([START]);
    expect(stdout).toContain(OTHER_FAILURE);
  });

  it("fails with the retry's status when the retry fails another way", () => {
    const { status, calls } = run([
      [1, PORT_CLASH],
      [7, OTHER_FAILURE],
    ]);
    expect(status).toBe(7);
    expect(calls).toEqual([START, LISTENERS, SOCKETS, STOP, START]);
  });

  it("still retries when the holders cannot be read", () => {
    const { status, calls } = run(
      [
        [1, PORT_CLASH],
        [0, "Started"],
      ],
      { sudoStatus: 1 },
    );
    expect(status).toBe(0);
    expect(calls.at(-1)).toBe(START);
  });

  it.each([
    "Error starting userland proxy: listen tcp4 0.0.0.0:54322: bind: address already in use",
    "Bind for 0.0.0.0:54322 failed: port is already allocated",
    "failed to bind host port for 0.0.0.0:54322:172.18.0.2:5432/tcp: address already in use",
  ])("treats Docker's other wording as a port clash: %s", (output) => {
    const { calls } = run([
      [1, output],
      [0, "Started"],
    ]);
    expect(calls).toEqual([START, LISTENERS, SOCKETS, STOP, START]);
  });

  it("lists every socket when the error names no port", () => {
    const { calls } = run([
      [1, "failed to bind host port: address already in use"],
      [0, "Started"],
    ]);
    expect(calls).toEqual([START, LISTENERS, "sudo ss -tanp", STOP, START]);
  });

  it("does not retry a database that reports a bind error inside its container", () => {
    const output = 'could not bind IPv4 address "0.0.0.0": Address already in use';
    const { status, calls } = run([[1, output]]);
    expect(status).toBe(1);
    expect(calls).toEqual([START]);
  });
});
