#!/bin/bash
pkill -f "node server.js" 2>/dev/null
sleep 1
cd "$(dirname "$0")"
node server.js &
echo "Loom restarted at http://localhost:3000"
