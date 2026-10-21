#!/bin/sh
cd "$(dirname "$0")" || exit 1
PORT=19091 node server/index.js --include-ws-fallback
