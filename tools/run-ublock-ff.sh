#!/bin/sh

set -e

pushd ../ublock/ # assumed location of ublock source

./tools/make-firefox.sh

cd ./dist/build/ublock0.firefox

web-ext run -v --bc --firefox-profile="${1:-'/Users/dhowe/Library/Application Support/Firefox/Profiles/ublock-dev'}" --firefox="${2:-firefox}"

popd
