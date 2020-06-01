#!/usr/bin/env bash
#
# This script assumes a linux environment
#
# Takes adnauseam.json files from crowdin (in ~/Downloads/adnauseam)
# and copies them into their locale specific locations in: src/_locales/
#
#
echo "*** AdNauseam: Importing from Crowdin archive"

SRC=~/Downloads/adnauseam
rm -r $SRC
<<<<<<< HEAD
unzip -q ~/Downloads/adnauseam.zip -d $SRC
=======
unzip -q ~/Downloads/uBlock.zip -d $SRC
>>>>>>> upstream1.23.0

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
#cp $SRC/en/adnauseam.json    $DES/en/adnauseam.json
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

cp $SRC/ar/description.txt    $DES/ar/description.txt
cp $SRC/bg/description.txt    $DES/bg/description.txt
cp $SRC/bn/description.txt    $DES/bn/description.txt
cp $SRC/ca/description.txt    $DES/ca/description.txt
cp $SRC/cs/description.txt    $DES/cs/description.txt
cp $SRC/cv/description.txt    $DES/cv/description.txt
cp $SRC/da/description.txt    $DES/da/description.txt
cp $SRC/de/description.txt    $DES/de/description.txt
cp $SRC/el/description.txt    $DES/el/description.txt
cp $SRC/eo/description.txt    $DES/eo/description.txt
cp $SRC/es-ES/description.txt $DES/es/description.txt
cp $SRC/et/description.txt    $DES/et/description.txt
cp $SRC/eu/description.txt    $DES/eu/description.txt
cp $SRC/fa/description.txt    $DES/fa/description.txt
cp $SRC/fi/description.txt    $DES/fi/description.txt
cp $SRC/fil/description.txt   $DES/fil/description.txt
cp $SRC/fr/description.txt    $DES/fr/description.txt
cp $SRC/fy-NL/description.txt $DES/fy/description.txt
cp $SRC/gl/description.txt    $DES/gl/description.txt
cp $SRC/he/description.txt    $DES/he/description.txt
cp $SRC/hi/description.txt    $DES/hi/description.txt
cp $SRC/hr/description.txt    $DES/hr/description.txt
cp $SRC/hu/description.txt    $DES/hu/description.txt
cp $SRC/id/description.txt    $DES/id/description.txt
cp $SRC/it/description.txt    $DES/it/description.txt
cp $SRC/ja/description.txt    $DES/ja/description.txt
cp $SRC/ko/description.txt    $DES/ko/description.txt
cp $SRC/lt/description.txt    $DES/lt/description.txt
cp $SRC/lv/description.txt    $DES/lv/description.txt
# cp $SRC/ms/description.txt    $DES/ms/description.txt
cp $SRC/mr/description.txt    $DES/mr/description.txt
cp $SRC/no/description.txt    $DES/nb/description.txt
cp $SRC/nl/description.txt    $DES/nl/description.txt
cp $SRC/pl/description.txt    $DES/pl/description.txt
cp $SRC/pt-BR/description.txt $DES/pt_BR/description.txt
cp $SRC/pt-PT/description.txt $DES/pt_PT/description.txt
cp $SRC/ro/description.txt    $DES/ro/description.txt
cp $SRC/ru/description.txt    $DES/ru/description.txt
cp $SRC/sk/description.txt    $DES/sk/description.txt
cp $SRC/sl/description.txt    $DES/sl/description.txt
cp $SRC/sq/description.txt    $DES/sq/description.txt
cp $SRC/sr/description.txt    $DES/sr/description.txt
cp $SRC/sv-SE/description.txt $DES/sv/description.txt
cp $SRC/ta/description.txt    $DES/ta/description.txt
cp $SRC/te/description.txt    $DES/te/description.txt
cp $SRC/tr/description.txt    $DES/tr/description.txt
cp $SRC/uk/description.txt    $DES/uk/description.txt
cp $SRC/vi/description.txt    $DES/vi/description.txt
cp $SRC/zh-CN/description.txt $DES/zh_CN/description.txt
cp $SRC/zh-TW/description.txt $DES/zh_TW/description.txt

echo "*** AdNauseam: Import done."

exit

#rm -r $SRC
