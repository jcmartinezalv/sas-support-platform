import crypto from "node:crypto";

export function createMobilePushOutbox({ initialDeliveries = [], onChange = () => {}, now = () => new Date() } = {}) {
  const deliveries = new Map(initialDeliveries.map((item) => [item.id, { ...item }]));
  return {
    enqueue({ userId, notifications = [], devices = [] }) {
      let queued = 0;
      const targets = devices.filter((item) => item.userId === userId && !item.revokedAt && item.fcmToken);
      for (const notification of notifications) for (const device of targets) {
        const dedupeKey = `${notification.id}:${device.id}`;
        if ([...deliveries.values()].some((item) => item.dedupeKey === dedupeKey)) continue;
        const id = `MPUSH-${crypto.randomUUID()}`;
        deliveries.set(id, { id, dedupeKey, userId, deviceId: device.id, notificationId: notification.id, type: notification.type, title: notification.title, message: notification.message, status: "pending_provider", attempts: 0, createdAt: now().toISOString(), updatedAt: now().toISOString() });
        queued += 1;
      }
      if (queued) persist();
      return { queued, targetDevices: targets.length };
    },
    list({ status, limit = 100 } = {}) { return [...deliveries.values()].filter((item) => !status || item.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(500, Math.max(1, Number(limit) || 100))).map(publicDelivery); },
    snapshot() { return [...deliveries.values()]; }
  };
  function persist() { onChange([...deliveries.values()]); }
}

function publicDelivery(item) {
  const { dedupeKey, userId, ...safe } = item;
  return safe;
}
