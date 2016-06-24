#!/bin/sh


#echo `pwd`

rm -rf bin/build/artifacts/*

./tools/make-chromium.sh all
./tools/make-firefox.sh all

cd bin/build/adnauseam.firefox
jpm xpi
cp null.xpi ../artifacts/adnauseam.firefox.xpi
cd -

ls -l bin/build/artifacts
