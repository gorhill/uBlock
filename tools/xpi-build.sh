#!/bin/sh


echo `pwd`

cd bin/build/adnauseam.firefox
jpm xpi
cp null.xpi ../adnauseam.xpi
ls ..
cd -

