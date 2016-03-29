#!/bin/sh


echo `pwd`

cd dist/build/adnauseam.firefox
jpm xpi
cp null.xpi ../adnauseam.firefox.xpi
ls ..
cd -

