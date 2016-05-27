#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** AdNauseam: Importing from Crowdin archive"

SRC=../crowdin
rm -r $SRC
unzip -q ../adnauseam.zip -d $SRC

DES=./src/_locales
cp $SRC/ar/adnauseam.json    $DES/ar/adnauseam.json
cp $SRC/bg/adnauseam.json    $DES/bg/adnauseam.json
cp $SRC/bn/adnauseam.json    $DES/bn/adnauseam.json
cp $SRC/ca/adnauseam.json    $DES/ca/adnauseam.json
cp $SRC/cs/adnauseam.json    $DES/cs/adnauseam.json
cp $SRC/cv/adnauseam.json    $DES/cv/adnauseam.json
cp $SRC/da/adnauseam.json    $DES/da/adnauseam.json
cp $SRC/de/adnauseam.json    $DES/de/adnauseam.json
cp $SRC/el/adnauseam.json    $DES/el/adnauseam.json
cp $SRC/eo/adnauseam.json    $DES/eo/adnauseam.json
cp $SRC/es-ES/adnauseam.json $DES/es/adnauseam.json
cp $SRC/et/adnauseam.json    $DES/et/adnauseam.json
cp $SRC/eu/adnauseam.json    $DES/eu/adnauseam.json
cp $SRC/fa/adnauseam.json    $DES/fa/adnauseam.json
cp $SRC/fi/adnauseam.json    $DES/fi/adnauseam.json
cp $SRC/fil/adnauseam.json   $DES/fil/adnauseam.json
cp $SRC/fr/adnauseam.json    $DES/fr/adnauseam.json
cp $SRC/fy-NL/adnauseam.json $DES/fy/adnauseam.json
cp $SRC/gl/adnauseam.json    $DES/gl/adnauseam.json
cp $SRC/he/adnauseam.json    $DES/he/adnauseam.json
cp $SRC/hi/adnauseam.json    $DES/hi/adnauseam.json
cp $SRC/hr/adnauseam.json    $DES/hr/adnauseam.json
cp $SRC/hu/adnauseam.json    $DES/hu/adnauseam.json
cp $SRC/id/adnauseam.json    $DES/id/adnauseam.json
cp $SRC/it/adnauseam.json    $DES/it/adnauseam.json
cp $SRC/ja/adnauseam.json    $DES/ja/adnauseam.json
cp $SRC/ko/adnauseam.json    $DES/ko/adnauseam.json
cp $SRC/lt/adnauseam.json    $DES/lt/adnauseam.json
cp $SRC/lv/adnauseam.json    $DES/lv/adnauseam.json
cp $SRC/mr/adnauseam.json    $DES/mr/adnauseam.json
#cp $SRC/ms/adnauseam.json    $DES/ms/adnauseam.json
cp $SRC/no/adnauseam.json    $DES/nb/adnauseam.json
cp $SRC/nl/adnauseam.json    $DES/nl/adnauseam.json
cp $SRC/pl/adnauseam.json    $DES/pl/adnauseam.json
cp $SRC/pt-BR/adnauseam.json $DES/pt_BR/adnauseam.json
cp $SRC/pt-PT/adnauseam.json $DES/pt_PT/adnauseam.json
cp $SRC/ro/adnauseam.json    $DES/ro/adnauseam.json
cp $SRC/ru/adnauseam.json    $DES/ru/adnauseam.json
cp $SRC/sk/adnauseam.json    $DES/sk/adnauseam.json
cp $SRC/sl/adnauseam.json    $DES/sl/adnauseam.json
cp $SRC/sq/adnauseam.json    $DES/sq/adnauseam.json
cp $SRC/sr/adnauseam.json    $DES/sr/adnauseam.json
cp $SRC/sv-SE/adnauseam.json $DES/sv/adnauseam.json
cp $SRC/ta/adnauseam.json    $DES/ta/adnauseam.json
cp $SRC/te/adnauseam.json    $DES/te/adnauseam.json
cp $SRC/tr/adnauseam.json    $DES/tr/adnauseam.json
cp $SRC/uk/adnauseam.json    $DES/uk/adnauseam.json
cp $SRC/vi/adnauseam.json    $DES/vi/adnauseam.json
cp $SRC/zh-CN/adnauseam.json $DES/zh_CN/adnauseam.json
cp $SRC/zh-TW/adnauseam.json $DES/zh_TW/adnauseam.json

rm -r $SRC
echo "*** AdNauseam: Import done."
