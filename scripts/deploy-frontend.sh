#!/usr/bin/env bash
set -euo pipefail
# Requires: repo-root .firebaserc, Firebase registered for that GCP project (see below), npm install at repo root.
#
# If deploy fails with HTTP 404 on .../projects/<id>/sites, the Google Cloud project exists but Firebase
# was never added to it: https://console.firebase.google.com → Add project → use existing Cloud project.
# Then enable Hosting in that Firebase project and run:
#   gcloud services enable firebase.googleapis.com firebasehosting.googleapis.com --project=<id>

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
npm run build
cd "$ROOT"

# Use project-local CLI (npm install at repo root); avoids needing global `firebase`.
DEPLOY=(npx firebase --non-interactive deploy --only hosting,firestore)
if [[ -n "${FIREBASE_PROJECT_ID:-}" ]]; then
  DEPLOY+=(--project "${FIREBASE_PROJECT_ID}")
fi
"${DEPLOY[@]}"
