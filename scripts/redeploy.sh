#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="artemis-f0c30"
REGION="us-central1"
SERVICE="artemis-backend"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Deploying Artemis..."

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud run deploy "$SERVICE" \
  --source "$ROOT_DIR/backend" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --quiet

(
  cd "$ROOT_DIR/frontend"
  npm run build
)

firebase deploy --only hosting --project "$PROJECT_ID"

echo "Done."
