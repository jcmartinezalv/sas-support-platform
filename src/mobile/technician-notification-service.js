const TECHNICIAN_ROLES = new Set(["admin", "supervisor", "technician"]);

export function createTechnicianNotificationService({
  mobileIdentityStore,
  mobileNotificationStore,
  mobilePushOutbox,
  ticketStore,
  knowledgeBaseStore,
  auditStore
}) {
  return {
    notifyEscalation() {
      const identity = mobileIdentityStore.snapshot();
      const users = identity.users.filter((user) => user.status === "active" && TECHNICIAN_ROLES.has(user.role));
      let notifications = 0;
      let pushDeliveries = 0;
      for (const user of users) {
        const synchronized = mobileNotificationStore.sync({
          userId: user.id,
          tickets: ticketStore.list(),
          articles: knowledgeBaseStore.list(),
          events: auditStore.list(0)
        });
        const unread = synchronized.filter((item) => !item.readAt);
        notifications += unread.length;
        pushDeliveries += mobilePushOutbox.enqueue({ userId: user.id, notifications: unread, devices: identity.devices }).queued;
      }
      return { technicians: users.length, notifications, pushDeliveries };
    }
  };
}