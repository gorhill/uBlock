#!/bin/sh

set -e

tools/make-firefox-adn.sh

cd bin/build/adnauseam.firefox 

jpm run --profile $1

cd -
