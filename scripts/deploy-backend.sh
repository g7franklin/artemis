#!/usr/bin/env bash
set -euo pipefail
# Usage: PROJECT_ID=your-gcp-project ./scripts/deploy-backend.sh
# Requires: gcloud auth, backend/.env (ENV or YAML) for Cloud Run --env-vars-file
#
# Both commands use --project so Cloud Build runs in the SAME project as the image
# (gcr.io/$PROJECT_ID). If your gcloud default is another project, omitting --project
# causes "uploadArtifacts denied" when pushing cross-project.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"

cd "$ROOT"
gcloud builds submit --project="${PROJECT_ID}" \
  --tag "gcr.io/${PROJECT_ID}/artemis-backend" \
  backend

# Cloud Run sets PORT itself; it must not appear in --env-vars-file.
# Temp file MUST end in .env: gcloud treats other names as YAML and dotenv lines fail to parse.
ENV_SRC="${ROOT}/backend/.env"
RUN_ENV="${TMPDIR:-/tmp}/artemis-cloudrun-$$.env"
trap 'rm -f "$RUN_ENV"' EXIT
grep -vE '^[[:space:]]*PORT[[:space:]]*=' "$ENV_SRC" > "$RUN_ENV"

gcloud run deploy artemis-backend \
  --project="${PROJECT_ID}" \
  --image "gcr.io/${PROJECT_ID}/artemis-backend" \
  --platform managed \
  --region us-east1 \
  --allow-unauthenticated \
  --port 8080 \
  --timeout 3600 \
  --env-vars-file="$RUN_ENV"

echo "Update frontend VITE_BACKEND_WS_URL to wss://<your-run-url>/voice"
