#!/bin/sh
set -eu

if [ -z "${API_URL:-}" ]; then
    echo "API_URL must be set to the HTTPS API base URL." >&2
    exit 1
fi

case "$API_URL" in
    https://*) ;;
    *)
        echo "API_URL must use HTTPS." >&2
        exit 1
        ;;
esac

case "$API_URL" in
    *[!A-Za-z0-9._:/-]*)
        echo "API_URL contains unsupported characters." >&2
        exit 1
        ;;
esac

api_authority=${API_URL#https://}
api_host=${api_authority%%/*}
if [ -z "$api_host" ] || [ "$api_authority" != "$api_host/api/v1" ]; then
    echo "API_URL must contain a host followed by exactly /api/v1." >&2
    exit 1
fi

printf 'window.__APP_CONFIG__ = Object.freeze({ apiUrl: "%s" });\n' "$API_URL" \
    > /usr/share/nginx/html/runtime-config.js
