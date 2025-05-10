#!/bin/sh

#-------------------------
# Versionen definieren
#-------------------------
GEBRV_LIBFILE="/usr/lib/aarch64-linux-gnu/pkgconfig/libgerbv.pc"
GERBV_VERSION="2.10.0"
NODEJS_VERSION="22"

#-------------------------
# Update System
#-------------------------
sudo apt update
sudo apt upgrade -y
sudo apt dist-upgrade -y

# Install Build Essentials & GIT
sudo apt install -y build-essential libudev-dev curl git automake autoconf autoconf-archive libtool libboost-program-options-dev libgtkmm-2.4-dev librsvg2-dev

# Install Useful Tools (Optional)
#sudo apt-get install htop iotop nmon lsof screen -y

#-------------------------
# Node.js
#-------------------------
# Install
curl -fsSL "https://deb.nodesource.com/setup_$NODEJS_VERSION.x" | sudo -E bash -
sudo apt install -y nodejs

#-------------------------
# PM2
#-------------------------
# Install
sudo apt update
sudo apt upgrade -y
sudo npm install -g pm2

# PM2 Startup-Skript konfigurieren
sudo pm2 startup systemd -u root --hp /root

#-------------------------
# CNCjs
#-------------------------
# Install
sudo apt update
sudo apt upgrade -y
sudo npm install -g cncjs

# Add - TinyWeb
cd ~
git clone https://github.com/cncjs/cncjs-pendant-tinyweb.git
cd cncjs-pendant-tinyweb
npm install

# Add - TabletWeb
cd ~
git clone https://github.com/cncjs/cncjs-shopfloor-tablet.git
cd cncjs-shopfloor-tablet
npm install

# -create config
cat <<EOF >~/.cncrc
{
  "mountPoints": [
    {
      "route": "/tinyweb",
      "target": "/home/jochen/tinyweb/"
    },
    {
      "route": "/tablet",
      "target": "/home/jochen/tablet/"
    }
  ],
  "baudrates": [115200],
  "accessTokenLifetime": "30d",
  "allowRemoteAccess": true,
  "controller": "Grbl",
  "state": {
    "checkForUpdates": true
  },
  "commands": [
    {
      "title": "Update (root user)",
      "commands": "sudo npm install -g cncjs@latest --unsafe-perm; pkill -a -f cnc"
    },
    {
      "title": "Update (non-root user)",
      "commands": "npm install -g cncjs@latest; pkill -a -f cnc"
    },
    {
      "title": "Reboot",
      "commands": "sudo /sbin/reboot"
    },
    {
      "title": "Shutdown",
      "commands": "sudo /sbin/shutdown"
    }
  ],
  "events": [],
  "macros": [],
  "users": []
}
EOF

# Add - Autolevel
git clone https://github.com/IchOK/cncjs-kt-ext.git
cd cncjs-kt-ext
sudo npm install

#-------------------------
# gerbv
#-------------------------
# Install
cd ~
wget "https://github.com/gerbv/gerbv/archive/refs/tags/v$GERBV_VERSION.tar.gz"
tar -xvzf "v$GERBV_VERSION.tar.gz"
cd "gerbv-$GERBV_VERSION"
autoreconf -fvi
./configure
make
sudo make install

# Add Version-Number to Lib-File
if [[ -f "$GEBRV_LIBFILE" ]]; then
    if grep -q "^GERBV_VERSION: *$" "$GEBRV_LIBFILE"; then
        sudo sed -i "s/^GERBV_VERSION: *$/GERBV_VERSION: $GERBV_VERSION/" "$GEBRV_LIBFILE"
    fi
fi

#-------------------------
# pcb2gcode
#-------------------------
cd ~
git clone https://github.com/pcb2gcode/pcb2gcode.git
cd pcb2gcode
autoreconf -fvi
./configure
make
sudo make install

#-------------------------
# GCode-Server
#-------------------------
# Create directory
mkdir pcb-gcode-server
cd pcb-gcode-server
npm init -y

# Install Packages
npm install express multer child_process unzipper archiver



#-------------------------
# PM2 Setup
#-------------------------
# Start CNCjs (on port 8000, /w Tinyweb mount point) with PM2
sudo pm2 start $(which cncjs)

# Start Autolevel (on port /usr/ttyUSB0) with PM2
cd cncjs-kt-ext/
sudo pm2 start pm2.config.js
cd ..

# Set current running apps to startup
sudo pm2 save

# Get list of PM2 processes
sudo pm2 list

sudo reboot now

