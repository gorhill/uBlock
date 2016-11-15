#!/bin/sh

# must first use browser to 'pack' extension for chrome & opera

rm -rf bin/build/artifacts/*

./tools/make-firefox.sh all

cd bin/build/adnauseam.firefox
jpm xpi
cp null.xpi ../artifacts/adnauseam.firefox.xpi
cd -

cp bin/build/*.crx bin/build/artifacts
cp bin/build/*.nex bin/build/artifacts

open bin/build/artifacts
