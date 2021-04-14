#!/bin/sh

set -e

tools/make-firefox.sh

pushd dist/build/adnauseam.firefox

web-ext run -v --bc --firefox-profile="${1:-default}" --firefox="${2:-firefox}"

popd
