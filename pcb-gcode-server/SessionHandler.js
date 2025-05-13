const { randomUUID } = require("crypto");

const sessions = new Map();

const defaultSessionData = {
  projectName: "",
  projectPath: "",
  projectConfig: {},
  projectSetup: {
    layers: 1,
    millDrillDia: 0.5,
    cutterDia: 0.5,
    boardThickness: 1.7,
  },
  gerberVersion: 0,
  gcodeVersion: 0,
  lastActive: Date.now(),
};

function createSession(data = {}) {
  const sessionId = randomUUID();
  // Merge defaults with provided data
  const sessionData = { ...defaultSessionData, ...data, lastActive: Date.now() };
  sessions.set(sessionId, sessionData);
  return sessionId;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.lastActive = Date.now();
  return session;
}

function destroySession(sessionId) {
  sessions.delete(sessionId);
}

function cleanupSessions(timeoutMs = 30 * 60 * 1000) {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > timeoutMs) {
      sessions.delete(id);
    }
  }
}

module.exports = { createSession, getSession, destroySession, cleanupSessions };