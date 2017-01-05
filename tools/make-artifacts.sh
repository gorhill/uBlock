#!/bin/sh

# must first use browser to 'pack' extension for chrome & opera

rm -rf artifacts/*

./tools/make-firefox.sh all

cd bin/build/adnauseam.firefox
jpm xpi
cp null.xpi ../../../artifacts/adnauseam.firefox.xpi
cd -

cp bin/build/*.crx artifacts/
cp bin/build/*.nex artifacts/

cd bin/build
zip -9 -r --exclude=*.DS_Store* ../../artifacts/adnauseam.chromium.zip adnauseam.chromium 
cd -

open artifacts
