import { afterEach, describe, expect, it, vi } from "vitest";
import { errorFields, log, redact } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ERROR_ALERT_WEBHOOK_URL;
});

describe("structured logging", () => {
  it("writes one JSON line per entry, errors to stderr", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    log("error", "Something failed", { path: "/invoices" });
    const entry = JSON.parse(err.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ level: "error", msg: "Something failed", path: "/invoices" });
    expect(typeof entry.time).toBe("string");
  });

  it("never writes a connection string or credential", () => {
    expect(redact("connect postgresql://neondb_owner:npg_SECRET@ep-x.neon.tech/db failed")).toBe("connect postgresql://****:****@ep-x.neon.tech/db failed");
    expect(redact("GET /x?token=abc123&page=2")).toBe("GET /x?token=****&page=2");
    expect(errorFields(new Error("bad postgres://u:p4ss@h/db"))).toMatchObject({ errorName: "Error", errorMessage: "bad postgres://****:****@h/db" });
  });

  it("posts errors to the alert webhook when one is configured, and survives a failing webhook", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    process.env.ERROR_ALERT_WEBHOOK_URL = "https://alerts.example/hook";
    expect(() => log("error", "Payment failed", { errorMessage: "timeout" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledWith("https://alerts.example/hook", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ text: "BAKAAL error: Payment failed — timeout", level: "error" });
  });

  it("sends nothing anywhere for info and warnings", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, "fetch");
    process.env.ERROR_ALERT_WEBHOOK_URL = "https://alerts.example/hook";
    log("info", "Started");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
