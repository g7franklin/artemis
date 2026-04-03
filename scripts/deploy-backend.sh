#!/usr/bin/env bash
set -euo pipefail
# Usage: PROJECT_ID=your-gcp-project ./scripts/deploy-backend.sh
# Requires: gcloud auth, backend/.env with production values for --set-env-vars or use --set-env-vars-from-file

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"

cd "$ROOT"
gcloud builds submit --tag "gcr.io/${PROJECT_ID}/artemis-backend" backend

gcloud run deploy artemis-backend \
  --image "gcr.io/${PROJECT_ID}/artemis-backend" \
  --platform managed \
  --region us-east1 \
  --allow-unauthenticated \
  --port 8080 \
  --timeout 3600 \
  --set-env-vars-from-file backend/.env

echo "Update frontend VITE_BACKEND_WS_URL to wss://<your-run-url>/voice"
