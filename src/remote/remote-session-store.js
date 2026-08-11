export function createRemoteSessionStore({ initialSessions = [], onChange = () => {}, security = {} } = {}) {
  const ttlMinutes = clampNumber(security.ttlMinutes ?? 60, 5, 1440);
  const consentMaxAttempts = clampNumber(security.consentMaxAttempts ?? 5, 1, 25);
  const controlMaxAttempts = clampNumber(security.controlMaxAttempts ?? 5, 1, 25);
  const sessions = new Map(initialSessions.map((session) => [session.id, normalizeSession(session, ttlMinutes, consentMaxAttempts, controlMaxAttempts)]));

  return {
    list() {
      sweepExpiredSessions();
      return [...sessions.values()];
    },

    get(id) {
      sweepExpiredSessions();
      return sessions.get(id) ?? null;
    },

    findByJoinCode(joinCode) {
      sweepExpiredSessions();
      const cleanCode = cleanText(joinCode).toUpperCase();
      return [...sessions.values()].find((session) => session.joinCode === cleanCode) ?? null;
    },

    create(input) {
      const now = new Date().toISOString();
      const session = normalizeSession({
        id: createId("RMT"),
        ticketId: cleanText(input.ticketId),
        requestedBy: cleanText(input.requestedBy) || "operator",
        customerPhone: cleanText(input.customerPhone),
        agentId: cleanText(input.agentId) || null,
        joinCode: createJoinCode(),
        status: "pending_customer_consent",
        accessMode: "attended",
        consent: {
          required: true,
          decision: "pending",
          decidedAt: null,
          decidedBy: null,
          ipAddress: null,
          userAgent: null
        },
        screenShare: createDefaultScreenShare(),
        controlConsent: createDefaultControlConsent(),
        commands: [],
        interactiveEvents: [],
        startedAt: null,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
        security: {
          consentAttempts: 0,
          consentMaxAttempts,
          controlAttempts: 0,
          controlMaxAttempts,
          lockedReason: null
        }
      });

      sessions.set(session.id, session);
      persist();
      return session;
    },

    assignAgent(id, agentId) {
      const session = sessions.get(id);
      if (!session) return null;
      const now = new Date().toISOString();
      session.agentId = cleanText(agentId) || null;
      if (session.consent.decision === "approved" && session.agentId) {
        session.status = "active";
        session.startedAt = session.startedAt ?? now;
        session.screenShare.enabled = true;
        session.screenShare.startedAt = session.screenShare.startedAt ?? now;
        session.screenShare.nextFrameAt = now;
      }
      session.updatedAt = now;
      persist();
      return session;
    },

    pairAgentByJoinCode(joinCode, agentId, metadata = {}) {
      const session = this.findByJoinCode(joinCode);
      if (!session) return null;
      const cleanAgentId = cleanText(agentId);
      if (!cleanAgentId) {
        const error = new Error("Agent identity is required");
        error.statusCode = 400;
        throw error;
      }
      if (isTerminalStatus(session.status) || isSessionExpired(session)) {
        const error = new Error("Remote session is no longer available for pairing");
        error.statusCode = 409;
        throw error;
      }
      if (session.agentId && session.agentId !== cleanAgentId) {
        const error = new Error("Remote session is already paired with another agent");
        error.statusCode = 409;
        throw error;
      }
      const now = new Date().toISOString();
      session.agentId = cleanAgentId;
      session.pairing = {
        pairedAt: session.pairing?.pairedAt ?? now,
        pairedBy: cleanText(metadata.pairedBy) || "agent_local_panel",
        hostname: cleanText(metadata.hostname)
      };
      if (session.consent.decision === "approved" && session.agentId) {
        session.status = "active";
        session.startedAt = session.startedAt ?? now;
        session.screenShare.enabled = true;
        session.screenShare.startedAt = session.screenShare.startedAt ?? now;
        session.screenShare.nextFrameAt = now;
      }
      session.updatedAt = now;
      persist();
      return session;
    },

    approveConsent(joinCode, metadata = {}) {
      const session = this.findByJoinCode(joinCode);
      if (!session) return null;

      if (expireIfNeeded(session)) { persist(); return session; }
      if (!recordConsentAttempt(session, consentMaxAttempts)) { persist(); return session; }
      const now = new Date().toISOString();
      session.status = session.agentId ? "active" : "authorized_waiting_agent_assignment";
      session.consent = {
        required: true,
        decision: "approved",
        decidedAt: now,
        decidedBy: cleanText(metadata.decidedBy) || "customer",
        ipAddress: cleanText(metadata.ipAddress),
        userAgent: cleanText(metadata.userAgent)
      };
      session.controlConsent = {
        required: false,
        decision: "approved",
        requestedAt: now,
        requestedBy: cleanText(metadata.decidedBy) || "customer",
        decidedAt: now,
        decidedBy: cleanText(metadata.decidedBy) || "customer",
        ipAddress: cleanText(metadata.ipAddress),
        userAgent: cleanText(metadata.userAgent)
      };
      session.permissions = { screen: true, input: true, uac: true, clipboard: true, files: true, fileUpload: true, fileDownload: true, grantedAt: now, grantedBy: cleanText(metadata.decidedBy) || "customer" };
      if (session.agentId) {
        session.startedAt = session.startedAt ?? now;
        session.startedBy = session.startedBy ?? "customer_authorization";
        session.screenShare.enabled = true;
        session.screenShare.startedAt = session.screenShare.startedAt ?? now;
        session.screenShare.startedBy = session.screenShare.startedBy ?? "customer_authorization";
        session.screenShare.nextFrameAt = now;
      }
      session.updatedAt = now;
      persist();
      return session;
    },

    requestUnattended(id, metadata = {}) {
      const session = sessions.get(id);
      if (!session) return null;
      if (expireIfNeeded(session)) { persist(); return session; }
      if (isTerminalStatus(session.status)) {
        const error = new Error("Remote session is no longer available");
        error.statusCode = 409;
        throw error;
      }
      if (!session.agentId) {
        const error = new Error("An agent must be assigned before unattended access");
        error.statusCode = 409;
        throw error;
      }
      const now = new Date().toISOString();
      session.accessMode = "unattended";
      session.status = "pending_unattended_authorization";
      session.unattendedRequest = {
        id: createId("UAR"),
        decision: "pending",
        requestedAt: now,
        requestedBy: cleanText(metadata.requestedBy) || "operator",
        expiresAt: new Date(Date.parse(now) + 2 * 60 * 1000).toISOString(),
        decidedAt: null,
        reason: null
      };
      session.updatedAt = now;
      persist();
      return session;
    },

    rejectUnattended(id, metadata = {}) {
      const session = sessions.get(id);
      if (!session) return null;
      const request = session.unattendedRequest;
      if (!request || request.decision !== "pending" || (metadata.requestId && request.id !== metadata.requestId)) {
        const error = new Error("Unattended request is no longer pending");
        error.statusCode = 409;
        throw error;
      }
      const now = new Date().toISOString();
      request.decision = "rejected";
      request.decidedAt = now;
      request.reason = cleanText(metadata.reason) || "local_policy_unavailable";
      session.status = "consent_rejected";
      session.consent = { ...session.consent, required: false, decision: "rejected", decidedAt: now, decidedBy: "sas_client_local_policy" };
      session.updatedAt = now;
      persist();
      return session;
    },
    authorizeUnattended(id, metadata = {}) {
      const session = sessions.get(id);
      if (!session) return null;
      if (expireIfNeeded(session)) { persist(); return session; }
      if (isTerminalStatus(session.status)) {
        const error = new Error("Remote session is no longer available");
        error.statusCode = 409;
        throw error;
      }
      if (!session.agentId) {
        const error = new Error("An agent must be assigned before unattended access");
        error.statusCode = 409;
        throw error;
      }
      const now = new Date().toISOString();
      if (session.unattendedRequest) {
        if (metadata.requestId && session.unattendedRequest.id !== metadata.requestId) {
          const error = new Error("Unattended request does not match");
          error.statusCode = 409;
          throw error;
        }
        session.unattendedRequest.decision = "approved";
        session.unattendedRequest.decidedAt = now;
        session.unattendedRequest.reason = null;
      }
      session.accessMode = "unattended";
      session.status = "authorized_waiting_agent";
      session.consent = {
        required: false,
        decision: "approved",
        decidedAt: now,
        decidedBy: "unattended_device_policy",
        ipAddress: cleanText(metadata.ipAddress),
        userAgent: cleanText(metadata.userAgent)
      };
      session.unattendedAuthorization = {
        authorizedAt: now,
        authorizedBy: cleanText(metadata.authorizedBy) || "operator",
        allowControl: Boolean(metadata.allowControl)
      };
      if (metadata.allowControl) {
        session.controlConsent = {
          required: false,
          decision: "approved",
          requestedAt: now,
          requestedBy: cleanText(metadata.authorizedBy) || "operator",
          decidedAt: now,
          decidedBy: "unattended_device_policy",
          ipAddress: cleanText(metadata.ipAddress),
          userAgent: cleanText(metadata.userAgent)
        };
      }
      session.permissions = { screen: true, input: Boolean(metadata.allowControl), uac: Boolean(metadata.allowControl), clipboard: Boolean(metadata.allowControl), files: true, fileUpload: true, fileDownload: true, grantedAt: now, grantedBy: "unattended_device_policy" };
      session.updatedAt = now;
      persist();
      return session;
    },

    rejectConsent(joinCode, metadata = {}) {
      const session = this.findByJoinCode(joinCode);
      if (!session) return null;

      if (expireIfNeeded(session)) { persist(); return session; }
      if (!recordConsentAttempt(session, consentMaxAttempts)) { persist(); return session; }
      const now = new Date().toISOString();
      session.status = "consent_rejected";
      session.consent = {
        required: true,
        decision: "rejected",
        decidedAt: now,
        decidedBy: cleanText(metadata.decidedBy) || "customer",
        ipAddress: cleanText(metadata.ipAddress),
        userAgent: cleanText(metadata.userAgent)
      };
      session.screenShare.enabled = false;
      session.screenShare.nextFrameAt = null;
      cancelQueuedCommands(session, "consent_rejected");
      cancelQueuedInteractiveEvents(session, "consent_rejected");
      session.controlConsent.decision = "rejected";
      session.controlConsent.decidedAt = now;
      session.updatedAt = now;
      persist();
      return session;
    },

    start(id, actorId) {
      const session = sessions.get(id);
      if (!session) return null;
      ensureCanStart(session);

      const now = new Date().toISOString();
      session.status = "active";
      session.startedAt = session.startedAt ?? now;
      session.startedBy = cleanText(actorId) || "operator";
      session.updatedAt = now;
      persist();
      return session;
    },

    close(id, actorId) {
      const session = sessions.get(id);
      if (!session) return null;
      return closeSession(session, actorId);
    },

    closeByJoinCode(joinCode, actorId) {
      const session = this.findByJoinCode(joinCode);
      if (!session) return null;
      return closeSession(session, actorId || "customer");
    },

    closeByAgent(sessionId, agentId) {
      const session = sessions.get(sessionId);
      if (!session || session.agentId !== cleanText(agentId)) return null;
      return closeSession(session, "agent-local-stop");
    },

    requestControl(id, actorId) {
      const session = sessions.get(id);
      if (!session) return null;
      ensureCanStart(session);
      if (["approved", "pending"].includes(session.controlConsent?.decision)) return session;
      const now = new Date().toISOString();
      session.controlConsent = {
        required: true,
        decision: "pending",
        requestedAt: now,
        requestedBy: cleanText(actorId) || "operator",
        decidedAt: null,
        decidedBy: null,
        ipAddress: null,
        userAgent: null
      };
      session.updatedAt = now;
      persist();
      return session;
    },

    decideControl(joinCode, decision, metadata = {}) {
      const session = this.findByJoinCode(joinCode);
      if (!session) return null;
      if (expireIfNeeded(session)) { persist(); return session; }
      if (!recordControlAttempt(session, controlMaxAttempts)) { persist(); return session; }
      const now = new Date().toISOString();
      const controlDecision = decision === "approved" ? "approved" : "rejected";
      session.controlConsent = {
        ...(session.controlConsent ?? createDefaultControlConsent()),
        required: true,
        decision: controlDecision,
        decidedAt: now,
        decidedBy: cleanText(metadata.decidedBy) || "customer",
        ipAddress: cleanText(metadata.ipAddress),
        userAgent: cleanText(metadata.userAgent)
      };
      if (controlDecision !== "approved") {
        cancelQueuedInteractiveEvents(session, "control_rejected");
      }
      session.updatedAt = now;
      persist();
      return session;
    },

    startScreenShare(id, actorId, options = {}) {
      const session = sessions.get(id);
      if (!session) return null;
      ensureCanStart(session);

      const now = new Date().toISOString();
      session.screenShare.enabled = true;
      const captureOptions = typeof options === "object" ? options : { intervalSeconds: options };
      session.screenShare.intervalSeconds = clampNumber(captureOptions.intervalSeconds ?? 1, 0.25, 30);
      session.screenShare.quality = clampNumber(captureOptions.quality ?? 62, 35, 90);
      session.screenShare.maxWidth = clampNumber(captureOptions.maxWidth ?? 1280, 640, 3840);
      session.screenShare.monitorIndex = clampNumber(captureOptions.monitorIndex ?? 0, 0, 15);
      session.screenShare.nativeResolution = Boolean(captureOptions.nativeResolution);
      session.screenShare.profile = normalizeScreenShareProfile(captureOptions.profile, session.screenShare.intervalSeconds);
      session.screenShare.startedAt = session.screenShare.startedAt ?? now;
      session.screenShare.startedBy = cleanText(actorId) || "operator";
      session.screenShare.stoppedAt = null;
      session.screenShare.nextFrameAt = now;
      session.updatedAt = now;
      persist();
      return session;
    },

    stopScreenShare(id, actorId) {
      const session = sessions.get(id);
      if (!session) return null;

      const now = new Date().toISOString();
      session.screenShare.enabled = false;
      session.screenShare.stoppedAt = now;
      session.screenShare.stoppedBy = cleanText(actorId) || "operator";
      session.screenShare.nextFrameAt = null;
      session.updatedAt = now;
      persist();
      return session;
    },

    queueCommand(id, input) {
      const session = sessions.get(id);
      if (!session) return null;
      if (!session.agentId) {
        const error = new Error("An agent must be assigned before queueing commands");
        error.statusCode = 409;
        throw error;
      }
      if (session.consent?.decision !== "approved") {
        const error = new Error("Customer consent is required before queueing remote commands");
        error.statusCode = 409;
        throw error;
      }
      if (["clipboard_set", "clipboard_get"].includes(input.type) && session.controlConsent?.decision !== "approved") { const error = new Error("Customer control consent is required for clipboard access"); error.statusCode = 409; throw error; }
      if (isTerminalStatus(session.status)) {
        const error = new Error("Remote session is not available for commands");
        error.statusCode = 409;
        throw error;
      }
      if (!isAllowedCommand(input.type)) {
        const error = new Error(`Command not allowed: ${input.type}`);
        error.statusCode = 400;
        throw error;
      }

      if (input.type === "clipboard_set" && (typeof input.clipboardText !== "string" || input.clipboardText.length > 200000)) {
        const error = new Error("Clipboard text must contain at most 200,000 characters"); error.statusCode = 400; throw error;
      }
      if (["clipboard_set", "clipboard_get"].includes(input.type) && session.permissions?.clipboard !== true) {
        const error = new Error("Clipboard permission is not active for this session"); error.statusCode = 403; throw error;
      }
      if (["file_upload", "file_upload_chunk"].includes(input.type) && session.permissions?.fileUpload !== true && session.permissions?.files !== true) {
        const error = new Error("File upload permission is not active for this session"); error.statusCode = 403; throw error;
      }
      if (["file_list", "file_download", "file_download_chunk"].includes(input.type) && session.permissions?.fileDownload !== true && session.permissions?.files !== true) {
        const error = new Error("File download permission is not active for this session"); error.statusCode = 403; throw error;
      }

      const command = createCommand(input);
      session.commands.push(command);
      pruneCommandHistory(session);
      session.updatedAt = command.updatedAt;
      persist();
      return command;
    },

    queueInteractiveEvent(id, input) {
      const session = sessions.get(id);
      if (!session) return null;
      if (!session.agentId) {
        const error = new Error("An agent must be assigned before queueing interactive events");
        error.statusCode = 409;
        throw error;
      }
      if (session.consent?.decision !== "approved") {
        const error = new Error("Customer consent is required before queueing interactive events");
        error.statusCode = 409;
        throw error;
      }
      if (session.status !== "active") {
        const error = new Error("Remote session must be active before queueing interactive events");
        error.statusCode = 409;
        throw error;
      }
      if (session.controlConsent?.decision !== "approved") {
        const error = new Error("Customer control consent is required before queueing interactive events");
        error.statusCode = 409;
        throw error;
      }
      if (!isAllowedInteractiveEvent(input.type)) {
        const error = new Error(`Interactive event not allowed: ${input.type}`);
        error.statusCode = 400;
        throw error;
      }

      validateInteractiveInput(input);

      if (session.permissions?.input !== true) {
        const error = new Error("Input permission is not active for this session"); error.statusCode = 403; throw error;
      }
      if (["secure_attention", "privileged_authorize"].includes(input.type) && session.permissions?.uac !== true) {
        const error = new Error("Elevated-control permission is not active for this session"); error.statusCode = 403; throw error;
      }

      if (["mouse_move", "mouse_move_relative"].includes(input.type)) {
        session.interactiveEvents = session.interactiveEvents.filter((item) => !(item.type === input.type && item.status === "queued"));
      } else if (session.interactiveEvents.filter((item) => item.status === "queued" && !["mouse_move", "mouse_move_relative"].includes(item.type)).length >= 256) {
        const error = new Error("Interactive input queue is saturated"); error.statusCode = 429; throw error;
      }
      const event = createInteractiveEvent(input);
      session.interactiveEvents.push(event);
      pruneInteractiveEventHistory(session);
      session.updatedAt = event.updatedAt;
      return event;
    },

    configureFisherObservation(id, input = {}) {
      const session = sessions.get(id);
      if (!session) return null;
      if (isTerminalStatus(session.status)) { const error = new Error("La sesión remota ya terminó"); error.statusCode = 409; throw error; }
      const now = new Date().toISOString();
      session.fisherObservation = {
        ...normalizeFisherObservation(session.fisherObservation),
        enabled: Boolean(input.enabled),
        intervalSeconds: clampNumber(input.intervalSeconds ?? session.fisherObservation?.intervalSeconds ?? 30, 15, 300),
        state: input.enabled ? "observing" : "paused",
        updatedAt: now, updatedBy: cleanText(input.actorId) || "operator"
      };
      session.updatedAt = now; persist(); return session;
    },

    recordFisherObservation(id, analysis = {}, metadata = {}) {
      const session = sessions.get(id);
      if (!session) return null;
      const now = new Date().toISOString();
      const current = normalizeFisherObservation(session.fisherObservation);
      const observation = {
        id: createId("FOB"), frameHash: cleanText(analysis.frameHash), frameAt: metadata.frameAt ?? session.screenShare?.lastFrameAt ?? null,
        summary: cleanText(analysis.summary).slice(0, 3000), visibleText: cleanStringList(analysis.visibleText, 12),
        likelyCauses: cleanStringList(analysis.likelyCauses, 8), safeChecks: cleanStringList(analysis.safeChecks, 8),
        planSteps: cleanStringList(analysis.planSteps, 8), riskSignals: cleanStringList(analysis.riskSignals, 8),
        needsHuman: Boolean(analysis.needsHuman), urgency: cleanText(analysis.urgency) || "normal", confidence: Math.max(0, Math.min(1, Number(analysis.confidence) || 0)),
        model: cleanText(analysis.model), review: { decision: "pending", note: "", reviewedAt: null, reviewedBy: null }, createdAt: now
      };
      current.enabled = true; current.state = "observing"; current.lastObservedAt = now; current.lastFrameHash = observation.frameHash;
      current.observations = [...current.observations, observation].slice(-20); current.updatedAt = now;
      session.fisherObservation = current; session.updatedAt = now; persist(); return observation;
    },

    reviewFisherObservation(id, observationId, input = {}) {
      const session = sessions.get(id);
      if (!session) return null;
      const current = normalizeFisherObservation(session.fisherObservation);
      const observation = current.observations.find((item) => item.id === cleanText(observationId));
      if (!observation) return null;
      const decision = ["confirmed", "corrected", "rejected"].includes(input.decision) ? input.decision : "pending";
      observation.review = { decision, note: cleanText(input.note).slice(0, 4000), reviewedAt: new Date().toISOString(), reviewedBy: cleanText(input.actorId) || "operator" };
      current.updatedAt = observation.review.reviewedAt; session.fisherObservation = current; session.updatedAt = current.updatedAt; persist(); return observation;
    },

    pendingForAgent(agentId) {
      const cleanAgentId = cleanText(agentId);
      const now = new Date();
      let changed = false;

      for (const session of sessions.values()) {
        if (session.agentId !== cleanAgentId || isTerminalStatus(session.status)) continue;
        if (!session.screenShare.enabled) continue;
        if (session.consent.decision !== "approved") continue;

        const lastFrameAge = session.screenShare.lastFrameAt ? now.getTime() - Date.parse(session.screenShare.lastFrameAt) : Infinity;
        const due = lastFrameAge > 2000 && (!session.screenShare.nextFrameAt || new Date(session.screenShare.nextFrameAt) <= now);
        const alreadyQueued = session.commands.some((command) => command.status === "queued" && command.purpose === "screen_share");
        if (due && !alreadyQueued) {
          const command = createCommand({
            type: "screenshot_preview",
            requestedBy: session.screenShare.startedBy || "operator",
            purpose: "screen_share",
            captureOptions: {
              quality: session.screenShare.quality,
              maxWidth: session.screenShare.maxWidth,
              monitorIndex: session.screenShare.monitorIndex,
              nativeResolution: session.screenShare.nativeResolution
            }
          });
          session.commands.push(command);
          session.screenShare.nextFrameAt = new Date(now.getTime() + session.screenShare.intervalSeconds * 1000).toISOString();
          session.updatedAt = command.updatedAt;
          changed = true;
        }
      }

      if (changed) persist();

      return [...sessions.values()]
        .filter((session) => session.agentId === cleanAgentId && !isTerminalStatus(session.status))
        .map((session) => ({
          ...session,
          screenShare: { ...session.screenShare, lastFrame: null },
          commands: session.consent?.decision === "approved"
            ? session.commands.filter((command) => command.status === "queued")
            : [],
          interactiveEvents: session.consent?.decision === "approved" && session.status === "active" && session.controlConsent?.decision === "approved"
            ? session.interactiveEvents.filter((event) => event.status === "queued")
            : []
        }));
    },

    publishScreenFrame(sessionId, agentId, frame) {
      const session = sessions.get(sessionId);
      if (!session || session.agentId !== cleanText(agentId) || !session.screenShare.enabled || session.consent?.decision !== "approved") return null;
      if (!frame?.imageBase64) return null;
      const now = new Date().toISOString();
      session.screenShare.lastFrame = frame;
      session.screenShare.lastFrameAt = frame.capturedAt || now;
      session.screenShare.lastFrameLatencyMs = Math.max(0, Date.now() - Date.parse(frame.capturedAt || now));
      session.screenShare.nextFrameAt = new Date(Date.now() + 2000).toISOString();
      session.updatedAt = now;
      return { session, frame };
    },
    completeCommand(sessionId, commandId, result) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      const command = session.commands.find((item) => item.id === commandId);
      if (!command) return null;

      if (command.status !== "queued") {
        return { session, command };
      }

      const now = new Date().toISOString();
      command.status = result?.ok === false ? "failed" : "completed";
      command.error = result?.error ?? null;
      command.updatedAt = now;

      if (command.purpose === "screen_share" && result?.data?.imageBase64) {
        session.screenShare.lastFrame = result.data;
        session.screenShare.lastFrameAt = now;
        session.screenShare.lastFrameLatencyMs = elapsedMs(command.createdAt, now);
        command.result = {
          mimeType: result.data.mimeType,
          capturedAt: result.data.capturedAt,
          storedAs: "screenShare.lastFrame"
        };
        pruneScreenShareCommands(session);
      } else {
        command.result = result?.data ?? null;
      }
      if (command.type === "clipboard_set") command.clipboardText = null;
      if (command.type === "file_upload_chunk" && command.fileTransfer) {
        command.fileTransfer.dataBase64 = null;
        pruneFileTransferCommands(session, command.fileTransfer.transferId);
      }
      if (command.type === "file_download_chunk" && command.fileTransfer) {
        pruneDownloadCommands(session, command.fileTransfer.path);
      }

      session.updatedAt = now;
      persist();
      return { session, command };
    },

    completeInteractiveEvent(sessionId, eventId, result) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      const event = session.interactiveEvents.find((item) => item.id === eventId);
      if (!event) return null;

      if (event.status !== "queued") {
        return { session, event };
      }

      const now = new Date().toISOString();
      event.status = result?.ok === false ? "failed" : result?.data?.simulated === false ? "completed" : "simulated";
      event.result = result?.data ?? null;
      event.error = result?.error ?? null;
      event.updatedAt = now;
      session.updatedAt = now;
      return { session, event };
    }
  };


  function sweepExpiredSessions() {
    let changed = false;
    for (const session of sessions.values()) {
      if (expireUnattendedRequestIfNeeded(session)) changed = true;
      if (expireIfNeeded(session)) changed = true;
    }
    if (changed) persist();
  }
  function closeSession(session, actorId) {
    const now = new Date().toISOString();
    session.status = "closed";
    session.endedAt = now;
    session.closedBy = cleanText(actorId) || "operator";
    session.screenShare.enabled = false;
    session.screenShare.nextFrameAt = null;
    cancelQueuedCommands(session, "session_closed");
    cancelQueuedInteractiveEvents(session, "session_closed");
    session.controlConsent.decision = session.controlConsent.decision === "approved" ? "revoked" : session.controlConsent.decision;
    session.permissions = { screen: false, input: false, uac: false, clipboard: false, files: false, fileUpload: false, fileDownload: false, revokedAt: now, revokedBy: session.closedBy };
    session.updatedAt = now;
    persist();
    return session;
  }

  function persist() {
    onChange([...sessions.values()].map((session) => ({ ...session, screenShare: { ...session.screenShare, lastFrame: null }, interactiveEvents: [], commands: (session.commands ?? []).map(redactPersistedCommand) })));
  }
}

function recordConsentAttempt(session, maxAttempts) {
  session.security = session.security ?? {};
  session.security.consentAttempts = Number(session.security.consentAttempts ?? 0) + 1;
  session.security.consentMaxAttempts = Number(session.security.consentMaxAttempts ?? maxAttempts);
  if (session.security.consentAttempts > session.security.consentMaxAttempts) {
    lockSession(session, "consent_locked", "consent_attempt_limit");
    return false;
  }
  return true;
}

function recordControlAttempt(session, maxAttempts) {
  session.security = session.security ?? {};
  session.security.controlAttempts = Number(session.security.controlAttempts ?? 0) + 1;
  session.security.controlMaxAttempts = Number(session.security.controlMaxAttempts ?? maxAttempts);
  if (session.security.controlAttempts > session.security.controlMaxAttempts) {
    lockSession(session, "control_locked", "control_attempt_limit");
    return false;
  }
  return true;
}

function expireUnattendedRequestIfNeeded(session) {
  const request = session.unattendedRequest;
  if (!request || request.decision !== "pending" || !request.expiresAt || Date.parse(request.expiresAt) > Date.now() || isTerminalStatus(session.status)) return false;
  const now = new Date().toISOString();
  request.decision = "rejected";
  request.decidedAt = now;
  request.reason = "request_expired";
  session.status = session.startedAt
    ? "active"
    : session.consent?.decision === "approved"
      ? "authorized_waiting_agent"
      : "pending_customer_consent";
  session.updatedAt = now;
  return true;
}
function expireIfNeeded(session) {
  if (!isSessionExpired(session) || isTerminalStatus(session.status)) return false;
  lockSession(session, "expired", "session_expired");
  return true;
}

function lockSession(session, status, reason) {
  const now = new Date().toISOString();
  session.status = status;
  session.endedAt = session.endedAt ?? now;
  session.screenShare.enabled = false;
  session.screenShare.nextFrameAt = null;
  session.security = { ...(session.security ?? {}), lockedReason: reason };
  if (status === "expired" && session.consent?.decision === "pending") {
    session.consent.decision = "expired";
  }
  if (status === "control_locked") {
    session.controlConsent.decision = "locked";
  }
  cancelQueuedCommands(session, reason);
  cancelQueuedInteractiveEvents(session, reason);
  session.updatedAt = now;
}

function isSessionExpired(session) {
  // Remote support remains available until an operator or customer closes it explicitly.
  return false;
}

function isTerminalStatus(status) {
  return ["closed", "consent_rejected", "expired", "consent_locked", "control_locked"].includes(status);
}
function cancelQueuedCommands(session, reason) {
  const now = new Date().toISOString();
  for (const command of session.commands ?? []) {
    if (command.status !== "queued") continue;
    command.status = "cancelled";
    command.error = reason;
    command.updatedAt = now;
  }
}

function cancelQueuedInteractiveEvents(session, reason) {
  const now = new Date().toISOString();
  for (const event of session.interactiveEvents ?? []) {
    if (event.status !== "queued") continue;
    event.status = "cancelled";
    event.error = reason;
    event.updatedAt = now;
  }
}
function normalizeSession(session, ttlMinutes = 60, consentMaxAttempts = 5, controlMaxAttempts = 5) {
  const legacyTimedOut = session.status === "expired" && session.security?.lockedReason === "session_expired";
  const restoredStatus = legacyTimedOut
    ? session.consent?.decision === "approved"
      ? session.startedAt ? "active" : "authorized_waiting_agent"
      : "pending_customer_consent"
    : session.status;
  return {
    ...session,
    status: restoredStatus,
    expiresAt: null,
    agentId: session.agentId ?? null,
    accessMode: session.accessMode === "unattended" ? "unattended" : "attended",
    unattendedRequest: session.unattendedRequest ? {
      id: cleanText(session.unattendedRequest.id),
      decision: ["pending", "approved", "rejected"].includes(session.unattendedRequest.decision) ? session.unattendedRequest.decision : "pending",
      requestedAt: session.unattendedRequest.requestedAt ?? null,
      requestedBy: cleanText(session.unattendedRequest.requestedBy),
      expiresAt: session.unattendedRequest.expiresAt ?? null,
      decidedAt: session.unattendedRequest.decidedAt ?? null,
      reason: cleanText(session.unattendedRequest.reason) || null
    } : null,
    unattendedAuthorization: session.unattendedAuthorization ? {
      authorizedAt: session.unattendedAuthorization.authorizedAt ?? null,
      authorizedBy: cleanText(session.unattendedAuthorization.authorizedBy),
      allowControl: Boolean(session.unattendedAuthorization.allowControl)
    } : null,
    pairing: session.pairing ? {
      pairedAt: session.pairing.pairedAt ?? null,
      pairedBy: cleanText(session.pairing.pairedBy),
      hostname: cleanText(session.pairing.hostname)
    } : null,
    joinCode: cleanText(session.joinCode).toUpperCase(),
    consent: {
      required: true,
      decision: session.consent?.decision ?? "pending",
      decidedAt: session.consent?.decidedAt ?? null,
      decidedBy: session.consent?.decidedBy ?? null,
      ipAddress: session.consent?.ipAddress ?? null,
      userAgent: session.consent?.userAgent ?? null
    },
    screenShare: {
      ...createDefaultScreenShare(),
      ...(session.screenShare ?? {})
    },
    controlConsent: {
      ...createDefaultControlConsent(),
      ...(session.controlConsent ?? {})
    },
    permissions: session.permissions ?? {
      screen: session.consent?.decision === "approved",
      input: session.controlConsent?.decision === "approved",
      uac: session.controlConsent?.decision === "approved",
      clipboard: session.controlConsent?.decision === "approved",
      files: session.consent?.decision === "approved",
      fileUpload: session.consent?.decision === "approved",
      fileDownload: session.consent?.decision === "approved",
      grantedAt: session.consent?.decidedAt ?? null,
      grantedBy: session.consent?.decidedBy ?? null
    },    commands: Array.isArray(session.commands) ? session.commands.slice(-200) : [],
    interactiveEvents: Array.isArray(session.interactiveEvents) ? session.interactiveEvents.slice(-300) : [],
    fisherObservation: normalizeFisherObservation(session.fisherObservation),
    startedAt: session.startedAt ?? null,
    endedAt: legacyTimedOut ? null : session.endedAt ?? null,
    security: legacyTimedOut ? { ...(session.security ?? {}), lockedReason: null } : session.security
  };
}

function createCommand(input) {
  const now = new Date().toISOString();
  return {
    id: createId("CMD"),
    type: input.type,
    purpose: input.purpose ?? "manual",
    status: "queued",
    requestedBy: cleanText(input.requestedBy) || "operator",
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    captureOptions: normalizeCaptureOptions(input.captureOptions),
    repairAction: normalizeRepairAction(input.repairAction),
    fileTransfer: normalizeFileTransfer(input.fileTransfer),
    clipboardText: typeof input.clipboardText === "string" ? input.clipboardText.slice(0, 200000) : null
  };
}

function normalizeFileTransfer(value) {
  if (!value || typeof value !== "object") return null;
  const name = cleanText(value.name).replace(/[\\/]/g, "_").slice(0, 180);
  const relativePath = safeRemotePath(value.relativePath);
  const downloadPath = safeRemotePath(value.path);
  const targetDirectory = safeRemotePath(value.targetDirectory);
  const transferId = cleanText(value.transferId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  const dataBase64 = typeof value.dataBase64 === "string" && value.dataBase64.length <= 7_000_000 ? value.dataBase64 : null;
  return {
    name,
    relativePath,
    path: downloadPath,
    targetDirectory,
    transferId,
    index: clampNumber(value.index ?? 0, 0, 1_000_000),
    total: clampNumber(value.total ?? 1, 1, 1_000_000),
    offset: clampNumber(value.offset ?? 0, 0, Number.MAX_SAFE_INTEGER),
    maxBytes: clampNumber(value.maxBytes ?? 1_048_576, 65_536, 1_048_576),
    dataBase64
  };
}function createInteractiveEvent(input) {
  const now = new Date().toISOString();
  return {
    id: createId("EVT"),
    type: input.type,
    status: "queued",
    payload: normalizeInteractivePayload(input.payload),
    requestedBy: cleanText(input.requestedBy) || "operator",
    result: null,
    error: null,
    simulated: true,
    createdAt: now,
    updatedAt: now
  };
}

function normalizeFisherObservation(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: Boolean(source.enabled), intervalSeconds: clampNumber(source.intervalSeconds ?? 30, 15, 300),
    state: source.enabled ? "observing" : (cleanText(source.state) || "paused"), lastObservedAt: source.lastObservedAt ?? null,
    lastFrameHash: cleanText(source.lastFrameHash), observations: Array.isArray(source.observations) ? source.observations.slice(-20) : [],
    updatedAt: source.updatedAt ?? null, updatedBy: cleanText(source.updatedBy) || null
  };
}
function cleanStringList(value, limit) {
  return Array.isArray(value) ? value.map((item) => cleanText(item).slice(0, 1200)).filter(Boolean).slice(0, limit) : [];
}

function createDefaultControlConsent() {
  return {
    required: true,
    decision: "not_requested",
    requestedAt: null,
    requestedBy: null,
    decidedAt: null,
    decidedBy: null,
    ipAddress: null,
    userAgent: null
  };
}

function createDefaultScreenShare() {
  return {
    enabled: false,
    intervalSeconds: 2,
    quality: 62,
    maxWidth: 1280,
    monitorIndex: 0,
    nativeResolution: false,
    startedAt: null,
    startedBy: null,
    stoppedAt: null,
    stoppedBy: null,
    nextFrameAt: null,
    lastFrame: null,
    lastFrameAt: null,
    lastFrameLatencyMs: null,
    profile: "balanced"
  };
}

function normalizeScreenShareProfile(profile, intervalSeconds) {
  const cleanProfile = cleanText(profile);
  if (["lowLatency", "balanced", "quality"].includes(cleanProfile)) return cleanProfile;
  if (intervalSeconds <= 1) return "lowLatency";
  if (intervalSeconds >= 3) return "quality";
  return "balanced";
}

function elapsedMs(start, end) {
  const startedAt = Date.parse(start);
  const endedAt = Date.parse(end);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  return Math.max(0, endedAt - startedAt);
}
function ensureCanStart(session) {
  if (isTerminalStatus(session.status)) {
    const error = new Error(`Remote session is not available: ${session.status}`);
    error.statusCode = 409;
    throw error;
  }
  if (isSessionExpired(session)) {
    const error = new Error("Remote session link has expired");
    error.statusCode = 409;
    throw error;
  }
  if (session.consent.decision !== "approved") {
    const error = new Error("Customer consent is required before starting remote support");
    error.statusCode = 409;
    throw error;
  }
  if (!session.agentId) {
    const error = new Error("An agent must be assigned before starting remote support");
    error.statusCode = 409;
    throw error;
  }
}

function pruneCommandHistory(session) {
  if (session.commands.length <= 200) return;
  const queued = session.commands.filter((command) => command.status === "queued");
  const history = session.commands.filter((command) => command.status !== "queued").slice(-Math.max(0, 200 - queued.length));
  session.commands = [...history, ...queued].slice(-250);
}
function pruneInteractiveEventHistory(session) {
  const queued = session.interactiveEvents.filter((event) => event.status === "queued");
  const history = session.interactiveEvents.filter((event) => event.status !== "queued").slice(-Math.max(0, 300 - queued.length));
  session.interactiveEvents = [...history, ...queued];
}
function redactPersistedCommand(command) {
  const persisted = { ...command, clipboardText: null };
  if (command.type === "clipboard_get" && command.result && typeof command.result === "object") {
    persisted.result = { length: Number(command.result.length ?? command.result.text?.length ?? 0), format: command.result.format ?? "text/plain", remoteEcho: Boolean(command.result.remoteEcho) };
  }
  return persisted;
}
function pruneDownloadCommands(session, downloadPath) {
  const related = session.commands.filter((command) => command.type === "file_download_chunk" && command.fileTransfer?.path === downloadPath && command.status !== "queued");
  if (related.length <= 2) return;
  const removable = new Set(related.slice(0, -2).map((command) => command.id));
  session.commands = session.commands.filter((command) => !removable.has(command.id));
}
function pruneFileTransferCommands(session, transferId) {
  const related = session.commands.filter((command) => command.type === "file_upload_chunk" && command.fileTransfer?.transferId === transferId);
  const completed = related.filter((command) => command.status !== "queued");
  if (completed.length <= 2) return;
  const removable = new Set(completed.slice(0, -2).map((command) => command.id));
  session.commands = session.commands.filter((command) => !removable.has(command.id));
}
function pruneScreenShareCommands(session) {
  const keep = [];
  let latestScreenCommandKept = false;
  for (const command of [...session.commands].reverse()) {
    if (command.purpose !== "screen_share") {
      keep.push(command);
      continue;
    }
    if (!latestScreenCommandKept) {
      keep.push(command);
      latestScreenCommandKept = true;
    }
  }
  session.commands = keep.reverse().slice(-60);
}

function normalizeCaptureOptions(options = {}) {
  if (!options || typeof options !== "object") return null;
  return {
    quality: clampNumber(options.quality ?? 62, 35, 90),
    maxWidth: clampNumber(options.maxWidth ?? 1280, 640, 3840),
    monitorIndex: clampNumber(options.monitorIndex ?? 0, 0, 15),
    nativeResolution: options.nativeResolution === true
  };
}

function isAllowedCommand(type) {
  return ["system_info", "network_info", "disk_info", "process_snapshot", "service_snapshot", "software_inventory", "startup_inventory", "security_status", "security_definitions_update", "security_scan_startup", "security_quarantine_file", "screenshot_preview", "repair_action", "file_list", "file_upload", "file_upload_chunk", "file_download", "file_download_chunk", "clipboard_set", "clipboard_get"].includes(type);
}

function validateInteractiveInput(input) {
  const type = cleanText(input?.type);
  const payload = input?.payload;
  if (payload !== undefined && (payload === null || typeof payload !== "object" || Array.isArray(payload))) {
    const error = new Error("Interactive payload must be an object"); error.statusCode = 400; throw error;
  }
  if (type === "mouse_button" && !["down", "up"].includes(cleanText(payload?.action).toLowerCase())) {
    const error = new Error("Mouse button action must be down or up"); error.statusCode = 400; throw error;
  }
  if (type === "mouse_move_relative" && (!Number.isFinite(Number(payload?.deltaX)) || !Number.isFinite(Number(payload?.deltaY)))) {
    const error = new Error("Relative mouse movement requires finite deltas"); error.statusCode = 400; throw error;
  }
  if (["key_down", "key_up", "key_press"].includes(type)) {
    const keys = Array.isArray(payload?.keys) ? payload.keys : [payload?.key];
    if (!keys.some((key) => cleanText(key))) { const error = new Error("Keyboard event requires at least one key"); error.statusCode = 400; throw error; }
  }
  if (type === "text_input" && (typeof payload?.text !== "string" || payload.text.length > 4000)) {
    const error = new Error("Text input must contain at most 4,000 characters"); error.statusCode = 400; throw error;
  }
}

function isAllowedInteractiveEvent(type) {
  return ["mouse_move", "mouse_move_relative", "mouse_button", "mouse_click", "mouse_double_click", "mouse_wheel", "key_down", "key_up", "key_press", "text_input", "release_input", "secure_attention", "privileged_authorize"].includes(type);
}

function normalizeRepairAction(action) {
  if (!action || typeof action !== "object") return null;
  return {
    id: cleanText(action.id),
    title: cleanText(action.title),
    category: cleanText(action.category),
    risk: cleanText(action.risk) || "medium",
    summary: cleanText(action.summary),
    expectedImpact: cleanText(action.expectedImpact),
    command: cleanText(action.command) || null,
    args: Array.isArray(action.args) ? action.args.map(cleanText).filter(Boolean).slice(0, 12) : null,
    powershell: cleanText(action.powershell) || null
  };
}
function normalizeInteractivePayload(payload = {}) {
  if (!payload || typeof payload !== "object") return {};
  const button = cleanText(payload.button).toLowerCase();
  const action = cleanText(payload.action).toLowerCase();
  return {
    x: clampNumber(payload.x, 0, 100000),
    y: clampNumber(payload.y, 0, 100000),
    relativeX: clampNumber(payload.relativeX, 0, 1),
    relativeY: clampNumber(payload.relativeY, 0, 1),
    button: ["left", "right", "middle"].includes(button) ? button : "left",
    action: ["down", "up"].includes(action) ? action : "",
    delta: clampNumber(payload.delta, -2400, 2400),
    horizontalDelta: clampNumber(payload.horizontalDelta, -2400, 2400),
    deltaX: clampNumber(payload.deltaX, -32767, 32767),
    deltaY: clampNumber(payload.deltaY, -32767, 32767),
    key: cleanText(payload.key).slice(0, 40),
    keys: Array.isArray(payload.keys) ? [...new Set(payload.keys.map((item) => cleanText(item).toUpperCase().slice(0, 40)).filter(Boolean))].slice(0, 8) : [],
    text: cleanText(payload.text).slice(0, 4000)
  };
}

function safeRemotePath(value) {
  return cleanText(value).replace(/\0/g, "").replaceAll("\\", "/").slice(0, 1000);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function createJoinCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function cleanText(value) {
  return String(value ?? "").trim();
}























