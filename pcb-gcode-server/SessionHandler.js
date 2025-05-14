const { randomUUID } = require("crypto");
const Project = require("./ProjectClass");

const sessions = new Map();

// Erzeuge ein Default-Objekt der Klasse Project für die Sessiondaten
const defaultSessionData = new Project();

function createSession(data = {}) {
  const sessionId = randomUUID();
  // Erzeuge eine neue Project-Instanz, ggf. mit überschriebenen Daten
  const sessionData = new Project({ ...defaultSessionData, ...data, lastActive: Date.now() });
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