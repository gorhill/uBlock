#!/bin/sh

FIREFOX_BIN=/Applications/FirefoxDeveloperEdition.app/Contents/MacOS/firefox-bin

set -e

tools/make-firefox.sh

cd dist/build/adnauseam.firefox

jpm -b ${FIREFOX_BIN} run --profile "${1:-default}"

cd -
