#!/bin/sh

set -e

tools/make-firefox.sh

cd bin/build/adnauseam.firefox

jpm run --profile ${1:-default}

cd -
