import { describe, expect, it } from "vitest";
import { isPublicAddress, parseRecordsAddress } from "./address";

describe("parseRecordsAddress", () => {
  it.each([
    ["https://rock.example.org", "https://rock.example.org"],
    ["rock.example.org", "https://rock.example.org"],
    ["https://rock.example.org/page/12?x=1", "https://rock.example.org"],
    ["https://ROCK.Example.org:8443/", "https://rock.example.org:8443"],
    ["https://8.8.8.8", "https://8.8.8.8"],
    ["https://198.17.255.255", "https://198.17.255.255"],
    ["https://198.20.0.1", "https://198.20.0.1"],
    ["https://203.0.114.1", "https://203.0.114.1"],
  ])("accepts %s as %s", (input, origin) => {
    expect(parseRecordsAddress(input, "Rock RMS")).toEqual({ ok: true, origin });
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
    "https://192.0.0.8",
    "https://192.0.2.1",
    "https://198.18.0.1",
    "https://198.19.255.254",
    "https://198.51.100.7",
    "https://203.0.113.10",
    "https://240.0.0.1",
    "https://255.255.255.255",
    "https://[::1]",
    "https://[fd00::1]",
    "not a url at all",
  ])("refuses %s", (input) => {
    expect(parseRecordsAddress(input, "Rock RMS").ok).toBe(false);
  });

  it.each([
    ["8.8.8.8", true],
    ["2606:4700::1111", true],
    ["10.1.2.3", false],
    ["203.0.113.5", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fd12::1", false],
    ["ff02::1", false],
    ["2001:db8::1", false],
    ["2002:a00:1::", false],
    ["::ffff:10.0.0.1", false],
    ["::ffff:8.8.8.8", true],
    ["not-an-ip", false],
  ])("isPublicAddress(%s) is %s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it("names the product in the reason", () => {
    expect(parseRecordsAddress("https://localhost", "Rock RMS")).toEqual({
      ok: false,
      reason: "Use your Rock RMS's public address.",
    });
  });
});
