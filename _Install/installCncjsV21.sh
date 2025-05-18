#!/bin/sh

#-------------------------
# Update System
#-------------------------
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get dist-upgrade -y

# Install Build Essentials & GIT
sudo apt install -y build-essential libudev-dev curl git

# Install Useful Tools (Optional)
#sudo apt-get install htop iotop nmon lsof screen -y

# Install nodejs
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Get Version info
echo "[NPM] ============"; which npm; npm -v;
echo "[NODE] ============"; which node; node -v

#-------------------------
# PM2
#-------------------------
# Installiere PM2 (Prozess-Manager)
sudo apt update
sudo apt upgrade -y
sudo npm install -g pm2

# PM2 Startup-Skript konfigurieren
sudo pm2 startup systemd -u root --hp /root

#-------------------------
# CNCjs
#-------------------------
# Install CNCjs
sudo apt update
sudo apt upgrade -y

# Install Latest Release Version of CNCjs
sudo npm install -g cncjs

# Install TinyWeb
cd ~
git clone https://github.com/cncjs/cncjs-pendant-tinyweb.git
cd cncjs-pendant-tinyweb
npm install

# Install TabletWeb
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

# Install Autolevel
git clone https://github.com/IchOK/cncjs-kt-ext.git
cd cncjs-kt-ext
sudo npm install
 
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

