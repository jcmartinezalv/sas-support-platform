import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";

function approvedStore(options = {}) {
  const store = createRemoteSessionStore(options);
  const created = store.create({ ticketId: "TCK-STATEFUL", requestedBy: "test" });
  store.assignAgent(created.id, "agent-stateful");
  store.approveConsent(created.joinCode, { decidedBy: "customer" });
  store.start(created.id, "operator");
  return { store, session: store.get(created.id) };
}

test("stateful mouse and keyboard events preserve transitions and relative movement", () => {
  const { store, session } = approvedStore();
  const down = store.queueInteractiveEvent(session.id, { type: "mouse_button", payload: { relativeX: .25, relativeY: .75, button: "right", action: "down" } });
  const up = store.queueInteractiveEvent(session.id, { type: "mouse_button", payload: { relativeX: .25, relativeY: .75, button: "right", action: "up" } });
  const relative = store.queueInteractiveEvent(session.id, { type: "mouse_move_relative", payload: { deltaX: -17, deltaY: 23 } });
  const keyDown = store.queueInteractiveEvent(session.id, { type: "key_down", payload: { keys: ["ctrl", "C"] } });
  const keyUp = store.queueInteractiveEvent(session.id, { type: "key_up", payload: { keys: ["c", "ctrl"] } });
  assert.deepEqual([down.payload.action, up.payload.action], ["down", "up"]);
  assert.deepEqual([relative.payload.deltaX, relative.payload.deltaY], [-17, 23]);
  assert.deepEqual(keyDown.payload.keys, ["CTRL", "C"]);
  assert.deepEqual(keyUp.payload.keys, ["C", "CTRL"]);
});

test("important input events are not silently discarded when the queue exceeds 100", () => {
  const { store, session } = approvedStore();
  for (let index = 0; index < 150; index += 1) {
    store.queueInteractiveEvent(session.id, { type: "key_press", payload: { keys: [index % 2 ? "A" : "B"] } });
  }
  const queued = store.get(session.id).interactiveEvents.filter((event) => event.status === "queued");
  assert.equal(queued.length, 150);
});

test("high-frequency pointer movement coalesces without removing button events", () => {
  const { store, session } = approvedStore();
  store.queueInteractiveEvent(session.id, { type: "mouse_move", payload: { relativeX: .1, relativeY: .1 } });
  const down = store.queueInteractiveEvent(session.id, { type: "mouse_button", payload: { button: "left", action: "down", relativeX: .2, relativeY: .2 } });
  store.queueInteractiveEvent(session.id, { type: "mouse_move", payload: { relativeX: .8, relativeY: .8 } });
  const events = store.get(session.id).interactiveEvents.filter((event) => event.status === "queued");
  assert.equal(events.filter((event) => event.type === "mouse_move").length, 1);
  assert.equal(events.some((event) => event.id === down.id), true);
});

test("strict validation rejects malformed transitions", () => {
  const { store, session } = approvedStore();
  assert.throws(() => store.queueInteractiveEvent(session.id, { type: "mouse_button", payload: { action: "click" } }), (error) => error.statusCode === 400);
  assert.throws(() => store.queueInteractiveEvent(session.id, { type: "key_down", payload: { keys: [] } }), (error) => error.statusCode === 400);
  assert.throws(() => store.queueInteractiveEvent(session.id, { type: "mouse_move_relative", payload: { deltaX: "bad", deltaY: 1 } }), (error) => error.statusCode === 400);
});

test("clipboard text is permission-gated and redacted from persistence", () => {
  let persisted = [];
  const { store, session } = approvedStore({ onChange: (value) => { persisted = value; } });
  const command = store.queueCommand(session.id, { type: "clipboard_set", clipboardText: "secreto de prueba" });
  const persistedCommand = persisted[0].commands.find((item) => item.id === command.id);
  assert.equal(persistedCommand.clipboardText, null);
  store.completeCommand(session.id, command.id, { ok: true, data: { length: 17, format: "text/plain" } });
  assert.equal(store.get(session.id).commands.find((item) => item.id === command.id).clipboardText, null);
  session.permissions.clipboard = false;
  assert.throws(() => store.queueCommand(session.id, { type: "clipboard_get" }), (error) => error.statusCode === 403);
});