import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE = {
  tickets: [],
  remoteSessions: [],
  agents: [],
  auditEvents: [],
  knowledgeArticles: [],
  repairOutcomes: [],
  mobileUsers: [],
  mobileDevices: [],
  mobileSessions: [],
  mobileNotifications: [],
  mobileNotificationPreferences: [],
  mobilePushDeliveries: [],
  clientEnrollments: [],
  deploymentCampaigns: [],
  contacts: [],
  companies: []
};

export function createJsonDatabase({ filePath, backupDir, backupEveryWrites = 20 }) {
  const absoluteFilePath = path.resolve(filePath);
  const absoluteBackupDir = path.resolve(backupDir);
  let state = loadState(absoluteFilePath);
  let writeCount = 0;
  let lastBackupPath = null;

  const api = {
    data() {
      return state;
    },

    replace(nextState) {
      state = normalizeState(nextState);
      save();
    },

    save,

    backup() {
      ensureDir(absoluteBackupDir);
      if (!fs.existsSync(absoluteFilePath)) {
        return null;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(absoluteBackupDir, `sas-db-${stamp}.json`);
      fs.copyFileSync(absoluteFilePath, backupPath);
      pruneBackups(absoluteBackupDir, 25);
      lastBackupPath = backupPath;
      return backupPath;
    },

    status() {
      const file = getFileInfo(absoluteFilePath);
      const backups = listBackups(absoluteBackupDir);
      const latestBackup = backups[0] ?? null;
      return {
        filePath: absoluteFilePath,
        exists: Boolean(file),
        size: file?.size ?? 0,
        updatedAt: file?.updatedAt ?? null,
        backupDir: absoluteBackupDir,
        backupEveryWrites,
        writesSinceStart: writeCount,
        lastBackupPath,
        backupCount: backups.length,
        latestBackup,
        collections: {
          tickets: state.tickets.length,
          remoteSessions: state.remoteSessions.length,
          agents: state.agents.length,
          auditEvents: state.auditEvents.length,
          knowledgeArticles: state.knowledgeArticles.length,
          repairOutcomes: state.repairOutcomes.length,
          mobileUsers: state.mobileUsers.length,
          mobileDevices: state.mobileDevices.length,
          mobileSessions: state.mobileSessions.length,
          mobileNotifications: state.mobileNotifications.length,
          mobileNotificationPreferences: state.mobileNotificationPreferences.length,
          mobilePushDeliveries: state.mobilePushDeliveries.length,
          clientEnrollments: state.clientEnrollments.length,
          deploymentCampaigns: state.deploymentCampaigns.length,
          contacts: state.contacts.length,
          companies: state.companies.length
        }
      };
    }
  };

  return api;

  function save() {
    ensureDir(path.dirname(absoluteFilePath));
    const tmpPath = `${absoluteFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmpPath, absoluteFilePath);

    writeCount += 1;
    if (writeCount % backupEveryWrites === 0) {
      api.backup();
    }
  }
}

function loadState(filePath) {
  if (!fs.existsSync(filePath)) {
    return structuredClone(DEFAULT_STATE);
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const normalizedRaw = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    return normalizeState(JSON.parse(normalizedRaw));
  } catch (error) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    fs.copyFileSync(filePath, corruptPath);
    console.warn(`SAS DB could not be parsed. Corrupt copy saved at ${corruptPath}`);
    return structuredClone(DEFAULT_STATE);
  }
}

function normalizeState(value) {
  return {
    tickets: Array.isArray(value?.tickets) ? value.tickets : [],
    remoteSessions: Array.isArray(value?.remoteSessions) ? value.remoteSessions : [],
    agents: Array.isArray(value?.agents) ? value.agents : [],
    auditEvents: Array.isArray(value?.auditEvents) ? value.auditEvents : [],
    knowledgeArticles: Array.isArray(value?.knowledgeArticles) ? value.knowledgeArticles : [],
    repairOutcomes: Array.isArray(value?.repairOutcomes) ? value.repairOutcomes : [],
    mobileUsers: Array.isArray(value?.mobileUsers) ? value.mobileUsers : [],
    mobileDevices: Array.isArray(value?.mobileDevices) ? value.mobileDevices : [],
    mobileSessions: Array.isArray(value?.mobileSessions) ? value.mobileSessions : [],
    mobileNotifications: Array.isArray(value?.mobileNotifications) ? value.mobileNotifications : [],
    mobileNotificationPreferences: Array.isArray(value?.mobileNotificationPreferences) ? value.mobileNotificationPreferences : [],
    mobilePushDeliveries: Array.isArray(value?.mobilePushDeliveries) ? value.mobilePushDeliveries : [],
    clientEnrollments: Array.isArray(value?.clientEnrollments) ? value.clientEnrollments : [],
    deploymentCampaigns: Array.isArray(value?.deploymentCampaigns) ? value.deploymentCampaigns : [],
    contacts: Array.isArray(value?.contacts) ? value.contacts : [],
    companies: Array.isArray(value?.companies) ? value.companies : []
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getFileInfo(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    size: stat.size,
    updatedAt: stat.mtime.toISOString()
  };
}

function listBackups(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((file) => file.startsWith("sas-db-") && file.endsWith(".json"))
    .map((file) => {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      return {
        file,
        path: fullPath,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
        mtime: stat.mtimeMs
      };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ mtime, ...backup }) => backup);
}

function pruneBackups(dirPath, keep) {
  const backups = listBackups(dirPath);
  backups.slice(keep).forEach((backup) => fs.unlinkSync(backup.path));
}





