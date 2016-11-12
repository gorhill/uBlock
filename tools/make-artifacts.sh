#!/bin/sh


#echo `pwd`

rm -rf bin/build/artifacts/*

./tools/make-firefox.sh all

cd bin/build/adnauseam.firefox
jpm xpi
cp null.xpi ../artifacts/adnauseam.firefox.xpi
cd -

./tools/make-chromium.sh 
cp bin/build/*.crx bin/build/artifacts

./tools/make-opera.sh 
cp bin/build/*.nex bin/build/artifacts

open bin/build/artifacts
