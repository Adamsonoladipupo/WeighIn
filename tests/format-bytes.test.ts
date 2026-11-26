
import { describe, it, expect } from "vitest";
import { formatBytes } from "../src/format-bytes";

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats small byte counts without conversion", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats one kilobyte", () => {
    expect(formatBytes(1024)).toBe("1,024 B (1 KB)");
  });

  it("formats fractional kilobytes", () => {
    expect(formatBytes(104857)).toBe(
      "104,857 B (102.4 KB)",
    );
  });

  it("formats megabytes", () => {
    expect(formatBytes(10485760)).toBe(
      "10,485,760 B (10 MB)",
    );
  });

  it("rejects negative values", () => {
    expect(() => formatBytes(-1)).toThrow(RangeError);
  });

  it("rejects non-finite values", () => {
    expect(() => formatBytes(Infinity)).toThrow(RangeError);
    expect(() => formatBytes(NaN)).toThrow(RangeError);
  });
});
