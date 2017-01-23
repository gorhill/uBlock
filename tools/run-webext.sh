#!/bin/sh

FIREFOX_BIN=/Applications/FirefoxDeveloperEdition.app/Contents/MacOS/firefox-bin

set -e

tools/make-webext.sh

cd bin/build/adnauseam.webext

jpm -b ${FIREFOX_BIN} run --profile "${1:-default}"

cd -
