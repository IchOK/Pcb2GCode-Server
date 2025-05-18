#!/bin/bash

# Update
sudo apt update
sudo apt install -y build-essential automake autoconf autoconf-archive libtool libboost-program-options-dev libgtkmm-2.4-dev gerbv git librsvg2-dev

#-------------------------
# gerbv - Install
#-------------------------
GEBRV_LIBFILE="/usr/lib/aarch64-linux-gnu/pkgconfig/libgerbv.pc"
GERBV_VERSION="2.10.0"

# Install
wget "https://github.com/gerbv/gerbv/archive/refs/tags/v$GERBV_VERSION.tar.gz"
tar -xvzf "v$GERBV_VERSION.tar.gz"
cd "gerbv-$GERBV_VERSION"
autoreconf -fvi
./configure
make
sudo make install

# Add GERBV_VERSION Number to Lib-File
if [[ -f "$GEBRV_LIBFILE" ]]; then
    if grep -q "^GERBV_VERSION: *$" "$GEBRV_LIBFILE"; then
        sudo sed -i "s/^GERBV_VERSION: *$/GERBV_VERSION: $GERBV_VERSION/" "$GEBRV_LIBFILE"
    fi
fi

#-------------------------
# pcb2gcode - Install
#-------------------------
git clone https://github.com/pcb2gcode/pcb2gcode.git
cd pcb2gcode
autoreconf -fvi
./configure
make
sudo make install

#-------------------------
# pcb2gcode - Server
#-------------------------
# Create directory
mkdir pcb-gcode-server
cd pcb-gcode-server
npm init -y

# Install Packages
npm install express multer child_process

# Create Server-Script
cat <<EOF >~server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Erstelle einen Express Server
const app = express();
const port = 3000;

// Definiere den Ordner, in dem die hochgeladenen Dateien gespeichert werden
const upload = multer({ dest: 'uploads/' });

// Definiere den Ordner für die GCode-Dateien
const gcodeOutputDir = 'gcodes';
if (!fs.existsSync(gcodeOutputDir)) {
    fs.mkdirSync(gcodeOutputDir);
}

// Route zur Anzeige der Upload-Seite
app.get('/', (req, res) => {
    res.send(`
        <h1>Gerber-Dateien hochladen</h1>
        <form ref='uploadForm' 
            id='uploadForm' 
            action='/upload' 
            method='post' 
            encType="multipart/form-data">
              <input type="file" name="gerberFile" />
              <input type='submit' value='Upload!' />
        </form>
    `);
});

// Route zum Hochladen der Gerber-Datei
app.post('/upload', upload.single('gerberFile'), (req, res) => {
    const gerberFile = req.file;

    if (!gerberFile) {
        return res.status(400).send('Keine Datei hochgeladen.');
    }

    console.log('Datei hochgeladen:', gerberFile.originalname);

    // Gib den Dateipfad der hochgeladenen Datei aus
    const gerberFilePath = path.join(__dirname, gerberFile.path);

    // Führe pcb2gcode aus
    const outputGCodePath = path.join(gcodeOutputDir, `${path.parse(gerberFile.originalname).name}.gcode`);
    const pcb2gcodeCommand = `pcb2gcode -P ${gerberFilePath} -o ${outputGCodePath}`;

    exec(pcb2gcodeCommand, (err, stdout, stderr) => {
        if (err) {
            console.error('Fehler beim Ausführen von pcb2gcode:', err);
            return res.status(500).send('Fehler bei der GCode-Generierung.');
        }

        if (stderr) {
            console.error('Fehler:', stderr);
            return res.status(500).send('Fehler bei der GCode-Generierung.');
        }

        console.log('GCode erfolgreich erstellt:', outputGCodePath);

        // Sende den GCode als Download-Link
        res.send(`
            <h1>GCode erfolgreich erstellt!</h1>
            <a href="/download/${path.parse(gerberFile.originalname).name}.gcode">GCode herunterladen</a>
        `);
    });
});

// Route zum Download des GCode
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(gcodeOutputDir, `${filename}.gcode`);

    // Überprüfe, ob die Datei existiert
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('GCode-Datei nicht gefunden.');
    }

    res.download(filePath, `${filename}.gcode`, (err) => {
        if (err) {
            console.error('Fehler beim Herunterladen der Datei:', err);
            res.status(500).send('Fehler beim Herunterladen der Datei.');
        }
    });
});

// Starte den Server
app.listen(port, () => {
    console.log(`Server läuft auf http://localhost:${port}`);
});

EOF

# Start Server
node server.js
node 