#!/bin/sh


#echo `pwd`

rm -rf bin/build/artifacts/*.xpi

#./tools/make-chromium.sh all
./tools/make-firefox.sh all

cd bin/build/adnauseam.firefox
jpm xpi
cp null.xpi ../artifacts/adnauseam.firefox.xpi
cd -

cp bin/build/*.crx bin/build/artifacts
cp bin/build/*.nex bin/build/artifacts

open bin/build/artifacts
