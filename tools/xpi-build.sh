#!/bin/sh


#echo `pwd`

cd dist/build/adnauseam.firefox
jpm xpi
cp null.xpi ../adnauseam.xpi
ls ..
cd -
