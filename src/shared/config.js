export const config = {
  httpPort: readNumber(process.env.HTTP_PORT ?? process.env.PORT, 80, 1, 65535),
  httpsPort: readNumber(process.env.HTTPS_PORT, 443, 1, 65535),
  enableHttp: readBool(process.env.ENABLE_HTTP, true),
  enableHttps: readBool(process.env.ENABLE_HTTPS, true),
  tlsKeyPath: process.env.TLS_KEY_PATH ?? "certs/server.key",
  tlsCertPath: process.env.TLS_CERT_PATH ?? "certs/server.crt",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "change-me",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? "",
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? "v25.0",
  whatsappMediaMaxBytes: readNumber(process.env.WHATSAPP_MEDIA_MAX_BYTES, 10485760, 1024, 26214400),
  fisherVisionEnabled: readBool(process.env.FISHER_VISION_ENABLED, true),
  fisherVisionMock: readBool(process.env.FISHER_VISION_MOCK, false),
  fisherVisionModel: process.env.FISHER_VISION_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.6-terra",
  fisherVisionMaxImages: readNumber(process.env.FISHER_VISION_MAX_IMAGES, 3, 1, 5),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "https://localhost",
  shortUrlProvider: process.env.SHORT_URL_PROVIDER ?? "auto",
  shortUrlTimeoutMs: readNumber(process.env.SHORT_URL_TIMEOUT_MS, 5000, 500, 30000),
  tinyUrlApiToken: process.env.TINYURL_API_TOKEN ?? "",
  tinyUrlDomain: process.env.TINYURL_DOMAIN ?? "tinyurl.com",
  bitlyAccessToken: process.env.BITLY_ACCESS_TOKEN ?? "",
  bitlyDomain: process.env.BITLY_DOMAIN ?? "bit.ly",
  agentSharedSecret: process.env.AGENT_SHARED_SECRET ?? "change-agent-secret",
  consoleSharedToken: process.env.CONSOLE_SHARED_TOKEN ?? "",
  agentHeartbeatSeconds: readNumber(process.env.AGENT_HEARTBEAT_SECONDS, 2, 1, 3600),
  dataFilePath: process.env.DATA_FILE_PATH ?? "data/sas-db.json",
  backupDir: process.env.BACKUP_DIR ?? "data/backups",
  googleAiEnabled: readBool(process.env.GOOGLE_AI_ENABLED, false),
  googleAiMock: readBool(process.env.GOOGLE_AI_MOCK, false),
  googleAiRequireReview: readBool(process.env.GOOGLE_AI_REQUIRE_REVIEW, true),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  googleAiModel: process.env.GOOGLE_AI_MODEL ?? "gemini-2.5-flash",
  openAiEnabled: readBool(process.env.OPENAI_ENABLED, false),
  openAiMock: readBool(process.env.OPENAI_MOCK, false),
  openAiRequireReview: true,
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-terra",
  openAiWebSearch: readBool(process.env.OPENAI_WEB_SEARCH, true),
  openAiReasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "low",
  aiResearchMode: process.env.AI_RESEARCH_MODE ?? "balanced",
  mobileBootstrapUsername: process.env.MOBILE_BOOTSTRAP_USERNAME ?? "",
  mobileBootstrapPassword: process.env.MOBILE_BOOTSTRAP_PASSWORD ?? "",
  mobileBootstrapDisplayName: process.env.MOBILE_BOOTSTRAP_DISPLAY_NAME ?? "Administrador movil",
  mobileAccessTtlMinutes: readNumber(process.env.MOBILE_ACCESS_TTL_MINUTES, 15, 1, 1440),
  mobileRefreshTtlDays: readNumber(process.env.MOBILE_REFRESH_TTL_DAYS, 30, 1, 365),
  mobileMaxFailedAttempts: readNumber(process.env.MOBILE_MAX_FAILED_ATTEMPTS, 5, 3, 20),
  mobileLockMinutes: readNumber(process.env.MOBILE_LOCK_MINUTES, 15, 1, 1440),
  clientEnrollmentTtlMinutes: readNumber(process.env.CLIENT_ENROLLMENT_TTL_MINUTES, 60, 10, 1440),
  clientInstallerPath: process.env.CLIENT_INSTALLER_PATH ?? "downloads/SAS-Cliente-Setup.exe",
  updateCheckEnabled: readBool(process.env.UPDATE_CHECK_ENABLED, true),
  updateApplyEnabled: readBool(process.env.UPDATE_APPLY_ENABLED, true),
  updateChannel: process.env.UPDATE_CHANNEL ?? "stable",
  updateBaseUrl: process.env.UPDATE_BASE_URL ?? `https://localhost/updates`,
  updateRoot: process.env.UPDATE_ROOT ?? "C:\\SAS\\Updates",
  updateTaskName: process.env.UPDATE_TASK_NAME ?? "SAS Support Server Production",
  updateSchedulerTaskName: process.env.UPDATE_SCHEDULER_TASK_NAME ?? "SAS Support Platform Update",
  updateHealthUrl: process.env.UPDATE_HEALTH_URL ?? `https://localhost/health`,
  updateTimeoutMs: readNumber(process.env.UPDATE_TIMEOUT_MS, 10000, 1000, 60000),
  updateCheckIntervalMinutes: readNumber(process.env.UPDATE_CHECK_INTERVAL_MINUTES, 360, 15, 10080),
  updateDownloadTimeoutMs: readNumber(process.env.UPDATE_DOWNLOAD_TIMEOUT_MS, 180000, 10000, 600000),
  updateMaxBytes: readNumber(process.env.UPDATE_MAX_BYTES, 536870912, 1048576, 1073741824),
  updateRequireSignature: readBool(process.env.UPDATE_REQUIRE_SIGNATURE, false),
  updatePublicKey: process.env.UPDATE_PUBLIC_KEY ?? "",
  updateAllowHttp: readBool(process.env.UPDATE_ALLOW_HTTP, false),
  remoteSessionTtlMinutes: readNumber(process.env.REMOTE_SESSION_TTL_MINUTES, 60, 5, 1440),
  remoteConsentMaxAttempts: readNumber(process.env.REMOTE_CONSENT_MAX_ATTEMPTS, 5, 1, 20),
  remoteControlMaxAttempts: readNumber(process.env.REMOTE_CONTROL_MAX_ATTEMPTS, 5, 1, 20),
  webrtcEnabled: readBool(process.env.WEBRTC_ENABLED, true),
  webrtcStunUrls: String(process.env.WEBRTC_STUN_URLS ?? "stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478").split(",").map((value) => value.trim()).filter(Boolean),
  webrtcTurnUrl: process.env.WEBRTC_TURN_URL ?? "",
  webrtcTurnUrls: String(process.env.WEBRTC_TURN_URLS ?? process.env.WEBRTC_TURN_URL ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  webrtcTurnUsername: process.env.WEBRTC_TURN_USERNAME ?? "",
  webrtcTurnCredential: process.env.WEBRTC_TURN_CREDENTIAL ?? "",
  webrtcTurnSecret: process.env.WEBRTC_TURN_SECRET ?? "",
  webrtcTurnCredentialTtlSeconds: readNumber(process.env.WEBRTC_TURN_CREDENTIAL_TTL_SECONDS, 600, 60, 86400),
  webrtcUdpMinPort: readNumber(process.env.WEBRTC_UDP_MIN_PORT, 49152, 1024, 65535),
  webrtcUdpMaxPort: readNumber(process.env.WEBRTC_UDP_MAX_PORT, 49200, 1024, 65535)
};

function readBool(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}







export function readNumber(value, fallback, min, max) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}


