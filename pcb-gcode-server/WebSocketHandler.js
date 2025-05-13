module.exports = function handleWebSocketMessage(ws, message) {
  let data;
  try {
    data = JSON.parse(message);
  } catch (err) {
    ws.send(JSON.stringify({ type: "error", message: "Ungültiges JSON" }));
    return;
  }

  switch (data.type) {
    case "createProject":
      // TODO: Projekt erstellen
      ws.send(JSON.stringify({ type: "createProject", status: "pending" }));
      break;
    case "selectProject":
      // TODO: Projekt auswählen
      ws.send(JSON.stringify({ type: "selectProject", status: "pending" }));
      break;
    case "getConfig":
      // TODO: Konfigdaten abrufen
      ws.send(JSON.stringify({ type: "getConfig", status: "pending" }));
      break;
    case "saveConfig":
      // TODO: Konfigdaten speichern
      ws.send(JSON.stringify({ type: "saveConfig", status: "pending" }));
      break;
    case "writeConfigFile":
      // TODO: Konfigdaten in Datei schreiben
      ws.send(JSON.stringify({ type: "writeConfigFile", status: "pending" }));
      break;
    case "convertProject":
      // TODO: Projekt konvertieren
      ws.send(JSON.stringify({ type: "convertProject", status: "pending" }));
      break;
    default:
      ws.send(JSON.stringify({ type: "error", message: "Unbekannter Anfrage-Typ" }));
  }
};