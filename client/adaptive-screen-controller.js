const LEVELS = [
  { name: "excellent", intervalMs: 55, quality: 72, maxWidth: 1920 },
  { name: "good", intervalMs: 75, quality: 66, maxWidth: 1680 },
  { name: "constrained", intervalMs: 110, quality: 56, maxWidth: 1440 },
  { name: "recovery", intervalMs: 180, quality: 45, maxWidth: 1120 }
];

export function createAdaptiveScreenState(now = Date.now()) {
  return {
    level: 1,
    congestionScore: 0,
    stableSamples: 0,
    captures: 0,
    sentFrames: 0,
    droppedFrames: 0,
    consecutiveDrops: 0,
    captureMsAverage: 0,
    encodeBytesAverage: 0,
    lastAdjustedAt: now,
    lastCaptureStartedAt: 0,
    lastDecision: "initial"
  };
}

export function adaptiveScreenPlan(state, input = {}) {
  const bufferedBytes = Math.max(0, Number(input.bufferedBytes) || 0);
  const captureMs = Math.max(0, Number(input.captureMs ?? state.captureMsAverage) || 0);
  const viewerFps = Math.max(0, Number(input.viewerFps) || 0);
  const viewerStaleMs = Math.max(0, Number(input.viewerStaleMs) || 0);
  const sendFailed = input.sendFailed === true;
  const now = Number(input.now) || Date.now();
  let pressure = 0;
  if (bufferedBytes >= 192 * 1024) pressure += 4;
  else if (bufferedBytes >= 96 * 1024) pressure += 3;
  else if (bufferedBytes >= 32 * 1024) pressure += 1;
  if (captureMs >= 170) pressure += 3;
  else if (captureMs >= 100) pressure += 2;
  else if (captureMs >= 70) pressure += 1;
  if (sendFailed) pressure += 4;
  if (viewerStaleMs > 1500) pressure += 3;
  else if (viewerFps > 0 && viewerFps < 5) pressure += 2;

  state.congestionScore = Math.max(0, Math.min(20, state.congestionScore * 0.65 + pressure));
  if (pressure >= 3) {
    state.stableSamples = 0;
    state.level = Math.min(LEVELS.length - 1, state.level + 1);
    state.lastAdjustedAt = now;
    state.lastDecision = sendFailed ? "send_failed" : "congestion";
  } else if (pressure === 0 && bufferedBytes < 16 * 1024 && captureMs < 65) {
    state.stableSamples += 1;
    if (state.stableSamples >= 12 && now - state.lastAdjustedAt >= 1500) {
      state.level = Math.max(0, state.level - 1);
      state.stableSamples = 0;
      state.lastAdjustedAt = now;
      state.lastDecision = "gradual_recovery";
    }
  } else {
    state.stableSamples = Math.max(0, state.stableSamples - 1);
  }

  const base = LEVELS[state.level];
  const requestedQuality = clamp(input.requestedQuality ?? 62, 35, 90);
  const requestedMaxWidth = clamp(input.requestedMaxWidth ?? 1920, 640, 3840);
  const nativeResolution = input.nativeResolution === true;
  return {
    level: state.level,
    mode: base.name,
    intervalMs: nativeResolution ? Math.max(base.intervalMs, 75) : base.intervalMs,
    quality: Math.min(requestedQuality, base.quality),
    maxWidth: nativeResolution ? requestedMaxWidth : Math.min(requestedMaxWidth, base.maxWidth),
    skipCapture: bufferedBytes >= 224 * 1024,
    bufferedBytes,
    congestionScore: Math.round(state.congestionScore * 10) / 10
  };
}

export function recordScreenCapture(state, { captureMs = 0, bytes = 0, sent = false } = {}) {
  state.captures += 1;
  state.captureMsAverage = movingAverage(state.captureMsAverage, Math.max(0, Number(captureMs) || 0), state.captures);
  state.encodeBytesAverage = movingAverage(state.encodeBytesAverage, Math.max(0, Number(bytes) || 0), state.captures);
  if (sent) {
    state.sentFrames += 1;
    state.consecutiveDrops = 0;
  } else {
    state.droppedFrames += 1;
    state.consecutiveDrops += 1;
  }
  return state;
}

export function publicScreenTelemetry(state, plan, extra = {}) {
  return {
    mode: plan?.mode ?? LEVELS[state.level]?.name ?? "unknown",
    intervalMs: plan?.intervalMs ?? null,
    quality: plan?.quality ?? null,
    maxWidth: plan?.maxWidth ?? null,
    bufferedBytes: Math.max(0, Number(extra.bufferedBytes ?? plan?.bufferedBytes) || 0),
    captureMs: Math.round(Number(extra.captureMs) || 0),
    captureMsAverage: Math.round(state.captureMsAverage),
    frameBytes: Math.max(0, Number(extra.frameBytes) || 0),
    averageFrameBytes: Math.round(state.encodeBytesAverage),
    captures: state.captures,
    sentFrames: state.sentFrames,
    droppedFrames: state.droppedFrames,
    consecutiveDrops: state.consecutiveDrops,
    congestionScore: plan?.congestionScore ?? Math.round(state.congestionScore * 10) / 10,
    lastDecision: state.lastDecision,
    viewer: extra.viewerFeedback ?? null
  };
}

function movingAverage(previous, value, count) {
  const weight = count <= 1 ? 1 : 0.2;
  return previous + (value - previous) * weight;
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}
