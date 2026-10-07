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

sampling_percentage=${APPLICATIONINSIGHTS_BROWSER_SAMPLING_PERCENTAGE:-100}
if ! awk -v value="$sampling_percentage" 'BEGIN {
    numeric = value ~ /^([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$/
    percentage = value + 0
    if (!numeric || percentage <= 0 || percentage > 100) {
        exit 1
    }
}'; then
    echo "APPLICATIONINSIGHTS_BROWSER_SAMPLING_PERCENTAGE must be finite, greater than 0, and at most 100." >&2
    exit 1
fi

telemetry_config=''
if [ -n "${APPLICATIONINSIGHTS_CONNECTION_STRING:-}" ]; then
    case "$APPLICATIONINSIGHTS_CONNECTION_STRING" in
        *[!A-Za-z0-9._:/=\;-]*)
            echo "APPLICATIONINSIGHTS_CONNECTION_STRING contains unsupported characters." >&2
            exit 1
            ;;
    esac

    encoded_connection_string=$(
        printf '%s' "$APPLICATIONINSIGHTS_CONNECTION_STRING" | base64 | tr -d '\n'
    )
    telemetry_config=", applicationInsightsConnectionString: atob(\"$encoded_connection_string\"), applicationInsightsSamplingPercentage: $sampling_percentage"
fi

runtime_config_output=${1:-/usr/share/nginx/html/runtime-config.js}
printf 'window.__APP_CONFIG__ = Object.freeze({ apiUrl: "%s"%s });\n' "$API_URL" "$telemetry_config" \
    > "$runtime_config_output"
