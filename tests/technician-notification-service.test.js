import test from "node:test";
import assert from "node:assert/strict";
import { createTechnicianNotificationService } from "../src/mobile/technician-notification-service.js";

test("human escalation immediately synchronizes active technicians and queues their devices", () => {
  const synced = [];
  const queued = [];
  const service = createTechnicianNotificationService({
    mobileIdentityStore: {
      snapshot() {
        return {
          users: [
            { id: "A1", role: "admin", status: "active" },
            { id: "T1", role: "technician", status: "active" },
            { id: "U1", role: "user", status: "active" },
            { id: "T2", role: "technician", status: "disabled" }
          ],
          devices: [{ id: "D1", userId: "T1", fcmToken: "token", revokedAt: null }]
        };
      }
    },
    mobileNotificationStore: {
      sync(input) { synced.push(input.userId); return [{ id: `N-${input.userId}`, readAt: null }]; }
    },
    mobilePushOutbox: {
      enqueue(input) { queued.push(input.userId); return { queued: input.userId === "T1" ? 1 : 0 }; }
    },
    ticketStore: { list: () => [] },
    knowledgeBaseStore: { list: () => [] },
    auditStore: { list: () => [{ id: "E1", action: "agent.escalated" }] }
  });
  const result = service.notifyEscalation();
  assert.deepEqual(synced.sort(), ["A1", "T1"]);
  assert.deepEqual(queued.sort(), ["A1", "T1"]);
  assert.equal(result.technicians, 2);
  assert.equal(result.pushDeliveries, 1);
});