import test from "node:test";
import assert from "node:assert/strict";
import { createMobileNotificationStore } from "../src/mobile/mobile-notification-store.js";

test("mobile notifications deduplicate urgent tickets and high-score knowledge", () => {
  const store = createMobileNotificationStore({ now: () => new Date("2026-07-12T12:00:00Z") });
  const input = { userId: "U1", tickets: [{ id: "T1", priority: "urgent", status: "open", subject: "Servidor caído", updatedAt: "now" }], articles: [{ id: "K1", status: "pending_review", reviewScore: 90, title: "DNS", updatedAt: "now" }] };
  store.sync(input); store.sync(input);
  assert.equal(store.list("U1").length, 2);
  assert.equal(store.list("U1", { unreadOnly: true }).length, 2);
});

test("mobile notifications are private per user and can be marked read", () => {
  const store = createMobileNotificationStore();
  store.sync({ userId: "U1", tickets: [{ id: "T1", priority: "urgent", status: "open", updatedAt: "1" }] });
  assert.equal(store.list("U2").length, 0);
  const notification = store.list("U1")[0];
  assert.ok(store.markRead("U1", notification.id).readAt);
  assert.equal(store.list("U1", { unreadOnly: true }).length, 0);
});

test("mobile notification preferences disable selected categories", () => {
  const store = createMobileNotificationStore();
  store.updatePreferences("U1", { urgentTickets: false });
  store.sync({ userId: "U1", tickets: [{ id: "T1", priority: "urgent", status: "open", updatedAt: "1" }] });
  assert.equal(store.list("U1").length, 0);
  assert.equal(store.getPreferences("U1").urgentTickets, false);
});

test("mobile notification inbox supports offset pagination", () => {
  let tick = 0;
  const store = createMobileNotificationStore({ now: () => new Date(2026, 0, 1, 0, 0, tick++) });
  for (let index = 0; index < 5; index += 1) store.sync({ userId: "U1", tickets: [{ id: `T${index}`, priority: "urgent", status: "open", updatedAt: String(index) }] });
  const page = store.list("U1", { limit: 2, offset: 2 });
  assert.equal(page.length, 2);
  assert.notEqual(page[0].id, store.list("U1", { limit: 1 })[0].id);
});
