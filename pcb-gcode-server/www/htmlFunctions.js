//###########################################################################################
//
// HTML Funktionen
// - Funktionen für den Seiten aufbau
//
//###########################################################################################

//-------------------------------------------------
// Anzeigen von Nachrichten
//-------------------------------------------------
function showMessageFromRetMsg(retMsg) {
  const messageBox = document.getElementById("messageBox");
  messageBox.style.display = "block";
  messageBox.className = retMsg.status || "";
  messageBox.textContent = retMsg.msg || "";
}

//-------------------------------------------------
// Update Lists
//-------------------------------------------------
function updateProjectList(strElementName, listElements, selectedElement) {
  const selestionList = document.getElementById(strElementName);
  if (!selestionList) {
    console.error(`Element mit ID ${strElementName} nicht gefunden.`);
    return;
  }
  // Liste löschen
  selestionList.innerHTML = "";
  // Liste aktualisieren
  let elementSelected = false;
  listElements.forEach((elements) => {
    const option = document.createElement("option");
    option.value = elements;
    option.textContent = elements;
    if (elements === selectedElement) {
      option.selected = true;
      elementSelected = true;
    }
    selestionList.appendChild(option);
  });
  // Letztes Projekt auswählen, falls kein anderes ausgewählt wurde
  if (!elementSelected && listElements.length > 0) {
    selestionList.value = listElements[listElements.length - 1];
  }
}
