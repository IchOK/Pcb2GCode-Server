//###########################################################################################
//
// FETCH Funktionen
// - Funktionen zur Datenabfrage am Server
//
//###########################################################################################

//-------------------------------------------------
// Session anfordern
//-------------------------------------------------
async function fetchSession() {
  try {
    const res = await fetch("/api/session");
    const data = await res.json();
    if (data.sessionId) {
      sessionId = data.sessionId;
      document.getElementById("sessionIdBox").textContent = sessionId;
      showMessageFromRetMsg({
        status: "done",
        msg: "Session erstellt.",
      });
      connectWebSocket(); // WebSocket nach Session-Erhalt verbinden
    } else {
      showMessageFromRetMsg({
        status: "error",
        msg: "Session konnte nicht erstellt werden.",
      });
    }
  } catch (err) {
    showMessageFromRetMsg({
      status: "error",
      msg: "Fehler beim Abrufen der Session.",
    });
  }
}

//-------------------------------------------------
// Projekt erstellen
//-------------------------------------------------
async function fetchCreateProject() {
  try {
    const res = await fetch("/api/projects", {
      headers: { "x-session-id": sessionId },
    });
    const data = await res.json();
    if (data.projects) {
      updateProjectList("projectSelect", data.projects, null);
    } else {
      showMessageFromRetMsg({
        status: "error",
        msg: "Fehler beim Abrufen der Projekte.",
      });
    }
  } catch (err) {
    showMessageFromRetMsg({
      status: "error",
      msg: "Fehler beim Abrufen der Projekte.",
    });
  }
}
