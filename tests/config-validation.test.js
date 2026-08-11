import test from "node:test";
import assert from "node:assert/strict";
import { readNumber } from "../src/shared/config.js";

test("numeric configuration accepts bounded integers", () => {
  assert.equal(readNumber("443", 80, 1, 65535), 443);
  assert.equal(readNumber(15, 5, 1, 60), 15);
});

test("numeric configuration falls back for invalid or unsafe values", () => {
  for (const value of ["abc", "1.5", "-1", "0", "70000", "Infinity", ""]) {
    assert.equal(readNumber(value, 443, 1, 65535), 443);
  }
});
