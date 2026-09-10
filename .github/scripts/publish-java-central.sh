#!/usr/bin/env bash
# Probe Central Portal auth and upload a deployment bundle with Bearer auth.
# Env: MAVEN_USERNAME, MAVEN_PASSWORD, BUNDLE_PATH (optional), DEPLOYMENT_NAME (optional)
set -euo pipefail

strip() {
  # trim leading/trailing whitespace and CR
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  v="${v//$'\r'/}"
  printf '%s' "$v"
}

USER_RAW="${MAVEN_USERNAME:-}"
PASS_RAW="${MAVEN_PASSWORD:-}"
USER="$(strip "$USER_RAW")"
PASS="$(strip "$PASS_RAW")"

if [[ -z "$USER" || -z "$PASS" ]]; then
  echo "MAVEN_CENTRAL_USERNAME / MAVEN_CENTRAL_PASSWORD must be non-empty" >&2
  exit 1
fi

if [[ "$USER" != "$USER_RAW" || "$PASS" != "$PASS_RAW" ]]; then
  echo "Note: trimmed whitespace/CR from Portal token secrets"
fi

echo "Portal token username_len=${#USER} password_len=${#PASS}"

TOKEN="$(printf '%s:%s' "$USER" "$PASS" | openssl base64 -A)"

probe() {
  local scheme="$1"
  local body_file
  body_file="$(mktemp)"
  local code
  code="$(curl -sS -o "$body_file" -w '%{http_code}' \
    -H "Authorization: ${scheme} ${TOKEN}" \
    'https://central.sonatype.com/api/v1/publisher/status?id=00000000-0000-0000-0000-000000000000' || true)"
  local body
  body="$(tr '\n' ' ' <"$body_file")"
  rm -f "$body_file"
  echo "Auth probe ${scheme}: HTTP ${code} body=${body}"
  if echo "$body" | grep -Eqi 'Invalid (auth|token)'; then
    return 1
  fi
  if [[ "$code" == "401" || "$code" == "403" ]]; then
    return 1
  fi
  # Fake deployment IDs can return 404/500 after auth succeeds. Treat those
  # as a passing probe; only auth rejection fails the job.
  return 0
}

echo "Probing Central Portal authentication…"
BEARER_OK=0
USERTOKEN_OK=0
probe Bearer && BEARER_OK=1 || true
probe UserToken && USERTOKEN_OK=1 || true

if [[ "$BEARER_OK" -ne 1 && "$USERTOKEN_OK" -ne 1 ]]; then
  cat >&2 <<'EOF'
Central Portal rejected the token (Invalid token / Invalid auth).

Confirm GitHub secrets match the two values from
https://central.sonatype.com/usertoken → Generate User Token:
  MAVEN_CENTRAL_USERNAME = User Token Username   (often short)
  MAVEN_CENTRAL_PASSWORD = User Token Password   (longer)

Do NOT store:
  - a pre-encoded Bearer base64 blob
  - Central/GitHub account login password
  - an OSSRH (oss.sonatype.org) token
  - only one of the two token fields

After updating secrets, re-run Java SDK - Release.
The account that owns the token must be allowed to publish io.toggly.
EOF
  exit 1
fi

AUTH_SCHEME=Bearer
if [[ "$BEARER_OK" -ne 1 ]]; then
  AUTH_SCHEME=UserToken
fi
echo "Using Authorization scheme: ${AUTH_SCHEME}"

BUNDLE_PATH="${BUNDLE_PATH:-}"
if [[ -z "$BUNDLE_PATH" ]]; then
  echo "BUNDLE_PATH not set — auth probe only"
  exit 0
fi

if [[ ! -f "$BUNDLE_PATH" ]]; then
  echo "Bundle not found: $BUNDLE_PATH" >&2
  exit 1
fi

NAME="${DEPLOYMENT_NAME:-toggly-java}"
echo "Uploading bundle ${BUNDLE_PATH} as ${NAME}…"
UPLOAD_BODY="$(mktemp)"
UPLOAD_CODE="$(curl -sS -o "$UPLOAD_BODY" -w '%{http_code}' \
  -H "Authorization: ${AUTH_SCHEME} ${TOKEN}" \
  -F "bundle=@${BUNDLE_PATH};type=application/octet-stream" \
  "https://central.sonatype.com/api/v1/publisher/upload?name=${NAME}&publishingType=AUTOMATIC")"

DEPLOYMENT_ID="$(tr -d '[:space:]' <"$UPLOAD_BODY")"
echo "Upload HTTP ${UPLOAD_CODE}; response=${DEPLOYMENT_ID}"
if [[ "$UPLOAD_CODE" != "201" && "$UPLOAD_CODE" != "200" ]]; then
  echo "Upload failed" >&2
  exit 1
fi
if [[ ! "$DEPLOYMENT_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "Unexpected deployment id: ${DEPLOYMENT_ID}" >&2
  exit 1
fi

echo "Polling deployment ${DEPLOYMENT_ID}…"
DEADLINE=$((SECONDS + 1800))
while (( SECONDS < DEADLINE )); do
  STATUS_BODY="$(mktemp)"
  STATUS_CODE="$(curl -sS -o "$STATUS_BODY" -w '%{http_code}' \
    -H "Authorization: ${AUTH_SCHEME} ${TOKEN}" \
    -X POST \
    "https://central.sonatype.com/api/v1/publisher/status?id=${DEPLOYMENT_ID}")"
  STATE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("deploymentState",""))' "$STATUS_BODY" 2>/dev/null || true)"
  echo "Status HTTP ${STATUS_CODE} state=${STATE:-unknown}"
  case "$STATE" in
    PUBLISHED)
      echo "Published successfully"
      cat "$STATUS_BODY"
      rm -f "$STATUS_BODY" "$UPLOAD_BODY"
      exit 0
      ;;
    FAILED)
      echo "Deployment FAILED:" >&2
      cat "$STATUS_BODY" >&2
      rm -f "$STATUS_BODY" "$UPLOAD_BODY"
      exit 1
      ;;
  esac
  rm -f "$STATUS_BODY"
  sleep 15
done

echo "Timed out waiting for PUBLISHED" >&2
exit 1
