const ROLE_PERMISSIONS = {
  admin: ["ticket:read", "ticket:write", "agent:read", "agent:write", "remote:request", "remote:approve", "remote:unattended", "repair:queue", "kb:write", "audit:read", "mobile:read", "mobile:approve", "system:update"],
  supervisor: ["ticket:read", "ticket:write", "agent:read", "remote:request", "remote:approve", "remote:unattended", "repair:queue", "kb:write", "audit:read", "mobile:read", "mobile:approve"],
  technician: ["ticket:read", "ticket:write", "agent:read", "remote:request", "repair:queue", "mobile:read"],
  ai_agent: ["ticket:read", "ticket:write", "remote:request", "repair:queue"],
  viewer: ["ticket:read", "agent:read", "mobile:read"]
};

export function createAuthService({ consoleToken = "" } = {}) {
  const requiredConsoleToken = String(consoleToken ?? "").trim();
  return {
    actorFromRequest(req) {
      const role = String(req.headers["x-sas-role"] ?? "technician").toLowerCase();
      const providedToken = readConsoleToken(req);
      return {
        id: String(req.headers["x-sas-actor"] ?? "local-operator"),
        role: ROLE_PERMISSIONS[role] ? role : "viewer",
        consoleTokenValid: !requiredConsoleToken || providedToken === requiredConsoleToken
      };
    },

    require(actor, permission) {
      if (requiredConsoleToken && !actor.consoleTokenValid) {
        const error = new Error("Console token required");
        error.statusCode = 401;
        error.authFailure = { reason: "console_token_required", permission, role: actor.role, actorId: actor.id };
        throw error;
      }

      const permissions = ROLE_PERMISSIONS[actor.role] ?? [];
      if (!permissions.includes(permission)) {
        const error = new Error(`Permission denied: ${permission}`);
        error.statusCode = 403;
        error.authFailure = { reason: "permission_denied", permission, role: actor.role, actorId: actor.id };
        throw error;
      }
    },

    listRoles() {
      return Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({ role, permissions }));
    },

    tokenRequired() {
      return Boolean(requiredConsoleToken);
    }
  };
}

function readConsoleToken(req) {
  const headerToken = String(req.headers["x-sas-console-token"] ?? "").trim();
  if (headerToken) return headerToken;

  const auth = String(req.headers.authorization ?? "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}





