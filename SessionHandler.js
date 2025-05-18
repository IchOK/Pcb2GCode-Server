const { randomUUID } = require("crypto");
const Project = require("./ProjectClass");

/**
 * Verwaltet Sitzungen (Sessions) für Benutzer und deren zugehörige Projektdaten.
 */
class SessionHandler {
  /**
   * Erstellt eine neue Instanz des SessionHandlers.
   */
  constructor() {
    /**
     * Map zur Speicherung der Sessions.
     * @type {Map<string, Project>}
     */
    this.sessions = new Map();
    /**
     * Standarddaten für neue Sessions.
     * @type {Project}
     */
    this.defaultSessionData = new Project();
  }

  /**
   * Erstellt eine neue Session.
   * @param {Object} [data={}] - Zusätzliche Daten für die Session.
   * @returns {string} Die ID der neu erstellten Session.
   */
  createSession(data = {}) {
    const sessionId = randomUUID();
    const sessionData = new Project({ ...this.defaultSessionData, ...data, lastActive: Date.now() });
    this.sessions.set(sessionId, sessionData);
    return sessionId;
  }

  /**
   * Gibt die Session-Daten für eine gegebene Session-ID zurück und aktualisiert den Zeitstempel.
   * @param {string} sessionId - Die ID der Session.
   * @returns {Project|undefined} Die Session-Daten oder undefined, falls nicht gefunden.
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) session.lastActive = Date.now();
    return session;
  }

  /**
   * Löscht eine Session anhand ihrer ID.
   * @param {string} sessionId - Die ID der zu löschenden Session.
   */
  destroySession(sessionId) {
    this.sessions.delete(sessionId);
  }

  /**
   * Entfernt alle Sessions, die länger als das angegebene Timeout inaktiv waren.
   * @param {number} [timeoutMs=1800000] - Timeout in Millisekunden (Standard: 30 Minuten).
   */
  cleanupSessions(timeoutMs = 30 * 60 * 1000) {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActive > timeoutMs) {
        this.sessions.delete(id);
      }
    }
  }
}

module.exports = SessionHandler;