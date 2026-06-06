#!/usr/bin/env bash
# Apply migrations and deploy the reveal-decision edge function to a hosted Supabase project.
# Usage: OPENAI_API_KEY=... GOOGLE_PLACES_API_KEY=... ./deploy.sh <PROJECT_REF>
set -euo pipefail

PROJECT_REF="${1:?Usage: ./deploy.sh <PROJECT_REF>}"
: "${OPENAI_API_KEY:?export OPENAI_API_KEY first}"
: "${GOOGLE_PLACES_API_KEY:?export GOOGLE_PLACES_API_KEY first}"

cd "$(dirname "$0")"

supabase link --project-ref "$PROJECT_REF"
supabase db push
supabase secrets set OPENAI_API_KEY="$OPENAI_API_KEY" GOOGLE_PLACES_API_KEY="$GOOGLE_PLACES_API_KEY"
supabase functions deploy reveal-decision
supabase functions deploy consensus

echo "Done. Remember to set the frontend env vars and Supabase Auth redirect URLs."
