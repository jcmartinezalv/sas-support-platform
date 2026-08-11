import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const script = fs.readFileSync("scripts/test-native-input-helper.ps1", "utf8");

test("native input self-test isolates click, text and Enter in a controlled window", () => {
  assert.match(script, /SasInputTestWindow/);
  assert.match(script, /GetForegroundWindow/);
  assert.match(script, /SetForegroundWindow/);
  assert.match(script, /mouse_click/);
  assert.match(script, /text_input/);
  assert.match(script, /key_press/);
  assert.match(script, /enterReceived/);
  assert.match(script, /Cursor\]::Position = \$originalCursor/);
  assert.match(script, /native_input_self_test_timeout/);
  assert.match(script, /powershell_signed_host/);
  assert.match(script, /MouseLeftClick/);
});
