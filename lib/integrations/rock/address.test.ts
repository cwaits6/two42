import { describe, expect, it } from "vitest";
import { parseRockAddress } from "./address";

describe("parseRockAddress", () => {
  it.each([
    ["https://rock.example.org", "https://rock.example.org"],
    ["rock.example.org", "https://rock.example.org"],
    ["https://rock.example.org/page/12?x=1", "https://rock.example.org"],
    ["https://ROCK.Example.org:8443/", "https://rock.example.org:8443"],
    ["https://203.0.113.10", "https://203.0.113.10"],
  ])("accepts %s as %s", (input, origin) => {
    expect(parseRockAddress(input)).toEqual({ ok: true, origin });
  });

  it.each([
    "",
    "http://rock.example.org",
    "ftp://rock.example.org",
    "https://user:pass@rock.example.org",
    "https://localhost",
    "https://rock.local",
    "https://metadata.internal",
    "https://intranet",
    "https://127.0.0.1",
    "https://10.0.0.5",
    "https://172.20.1.1",
    "https://192.168.1.10",
    "https://169.254.169.254",
    "https://100.64.0.1",
    "https://0.0.0.0",
    "https://[::1]",
    "https://[fd00::1]",
    "not a url at all",
  ])("refuses %s", (input) => {
    expect(parseRockAddress(input).ok).toBe(false);
  });
});
