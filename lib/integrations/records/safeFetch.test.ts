import { describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import { RefusedAddressError, guardedLookup, safeFetch } from "./safeFetch";

function resolving(addresses: LookupAddress[]) {
  return (_host: string, _options: unknown, callback: (err: Error | null, a: LookupAddress[]) => void) =>
    callback(null, addresses);
}

describe("guardedLookup", () => {
  it("passes a name that resolves only to public addresses", () => {
    const callback = vi.fn();
    guardedLookup(resolving([{ address: "8.8.8.8", family: 4 }]))("rock.example.org", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it("returns every address when asked for all", () => {
    const callback = vi.fn();
    const addresses = [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ];
    guardedLookup(resolving(addresses))("rock.example.org", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, addresses);
  });

  it.each([
    [[{ address: "10.0.0.5", family: 4 }]],
    [[{ address: "127.0.0.1", family: 4 }]],
    [[{ address: "169.254.169.254", family: 4 }]],
    [[{ address: "::1", family: 6 }]],
    [[{ address: "8.8.8.8", family: 4 }, { address: "192.168.1.1", family: 4 }]],
    [[]],
  ])("refuses a name resolving to %j", (addresses) => {
    const callback = vi.fn();
    guardedLookup(resolving(addresses))("rock.example.org", {}, callback);
    expect(callback.mock.calls[0][0]).toBeInstanceOf(RefusedAddressError);
  });

  it("passes on a resolver error", () => {
    const callback = vi.fn();
    const failure = new Error("ENOTFOUND");
    guardedLookup((_h, _o, cb) => cb(failure, []))("nowhere.example.org", {}, callback);
    expect(callback.mock.calls[0][0]).toBe(failure);
  });
});

describe("safeFetch", () => {
  it("refuses http", async () => {
    await expect(safeFetch("http://rock.example.org/api/People")).rejects.toBeInstanceOf(TypeError);
  });

  it("refuses a private address written as a literal, before any connection", async () => {
    await expect(safeFetch("https://10.0.0.5/api/People")).rejects.toBeInstanceOf(RefusedAddressError);
    await expect(safeFetch("https://[::1]/api/People")).rejects.toBeInstanceOf(RefusedAddressError);
  });
});

describe("safeFetch's methods", () => {
  it("refuses any method but GET and POST, before any connection", async () => {
    await expect(safeFetch("https://10.0.0.5/api/People", { method: "PUT" })).rejects.toThrow("Only GET and POST");
    await expect(safeFetch("https://10.0.0.5/api/People", { method: "DELETE" })).rejects.toThrow("Only GET and POST");
  });

  it("refuses a request body, before any connection", async () => {
    await expect(safeFetch("https://10.0.0.5/api/Workflows", { method: "POST", body: "{}" })).rejects.toThrow(
      "Request bodies aren't sent.",
    );
  });
});
