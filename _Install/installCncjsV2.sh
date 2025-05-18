#!/bin/bash

# Update und Upgrade des Systems
echo "Aktualisiere das System..."
sudo apt update && sudo apt upgrade -y

# Installiere notwendige Abhängigkeiten
echo "Installiere Abhängigkeiten..."
sudo apt install -y build-essential libudev-dev curl git

# Installiere Node.js (empfohlene Version für CNCjs)
echo "Installiere Node.js..."
curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
sudo apt install -y nodejs

# Überprüfe, ob Node.js und npm erfolgreich installiert wurden
echo "Überprüfe die Node.js und npm Versionen..."
node -v
npm -v

# Installiere PM2 (Prozess-Manager)
echo "Installiere PM2..."
sudo npm install -g pm2

# PM2 Startup-Skript konfigurieren
echo "Konfiguriere PM2 Startup-Skript..."
pm2 startup systemd -u pi --hp /home/pi

# Installiere CNCjs
echo "Installiere CNCjs..."
sudo npm install -g cncjs

# Installiere CNCjs Erweiterungen
echo "Installiere Erweiterungen: Pendant Tinyweb und Shopfloor Tablet..."
cd ~
git clone https://github.com/cncjs/cncjs-pendant-tinyweb.git
git clone https://github.com/cncjs/cncjs-shopfloor-tablet.git

# Installiere die Erweiterungen
cd cncjs-pendant-tinyweb
npm install
cd ~/cncjs-shopfloor-tablet
npm install

# Starte CNCjs mit PM2 (verwende den vollen Pfad zu cncjs)
echo "Starte CNCjs mit PM2..."
pm2 start $(which cncjs) -- --port 8000 -m /tinyweb:/home/pi/tinyweb -m /shopfloor:/home/pi/shopfloor

# Speichere die PM2-Prozessliste, damit CNCjs nach einem Neustart automatisch startet
echo "Speichere PM2-Prozessliste für Autostart..."
pm2 save

# CNCjs Erweiterungen in der .cncrc Konfigurationsdatei eintragen
echo "Füge Mount-Points in der .cncrc Konfigurationsdatei hinzu..."
CNCRC_FILE=~/.cncrc

# Sicherstellen, dass die Datei existiert
if [ ! -f "$CNCRC_FILE" ]; then
  echo "Die .cncrc Konfigurationsdatei existiert nicht. Erstelle eine neue Datei."
  touch "$CNCRC_FILE"
fi

# Mount-Points für die Erweiterungen hinzufügen
echo "Hinzufügen der Mount-Points für die Erweiterungen..."
cat <<EOL >> "$CNCRC_FILE"
{
  "web": {
    "mount": {
      "/tinyweb": "/home/pi/tinyweb",
      "/shopfloor": "/home/pi/shopfloor"
    }
  }
}
EOL

# Überprüfe die laufenden PM2-Prozesse
echo "PM2-Prozesse anzeigen..."
pm2 list

# CNCjs sollte jetzt im Hintergrund laufen. Du kannst die Web-Oberfläche im Browser aufrufen:
# http://<Deine_Pi_IP>:8000
echo "Installation abgeschlossen! Du kannst CNCjs im Webbrowser unter http://<Deine_Pi_IP>:8000 erreichen."
