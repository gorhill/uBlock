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
unzip -q ~/Downloads/adnauseam.zip -d $SRC

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

#
echo "*** AdNauseam: Import done."

# skip descriptions for now
exit

DES=./dist/description
cp $SRC/ar/description.txt    $DES/description-ar.txt
cp $SRC/bg/description.txt    $DES/description-bg.txt
cp $SRC/bn/description.txt    $DES/description-bn.txt
cp $SRC/ca/description.txt    $DES/description-ca.txt
cp $SRC/cs/description.txt    $DES/description-cs.txt
cp $SRC/cv/description.txt    $DES/description-cv.txt
cp $SRC/da/description.txt    $DES/description-da.txt
cp $SRC/de/description.txt    $DES/description-de.txt
cp $SRC/el/description.txt    $DES/description-el.txt
cp $SRC/eo/description.txt    $DES/description-eo.txt
cp $SRC/es-ES/description.txt $DES/description-es.txt
cp $SRC/et/description.txt    $DES/description-et.txt
cp $SRC/eu/description.txt    $DES/description-eu.txt
cp $SRC/fa/description.txt    $DES/description-fa.txt
cp $SRC/fi/description.txt    $DES/description-fi.txt
cp $SRC/fil/description.txt   $DES/description-fil.txt
cp $SRC/fr/description.txt    $DES/description-fr.txt
cp $SRC/fy-NL/description.txt $DES/description-fy.txt
cp $SRC/gl/description.txt    $DES/description-gl.txt
cp $SRC/he/description.txt    $DES/description-he.txt
cp $SRC/hi/description.txt    $DES/description-hi.txt
cp $SRC/hr/description.txt    $DES/description-hr.txt
cp $SRC/hu/description.txt    $DES/description-hu.txt
cp $SRC/id/description.txt    $DES/description-id.txt
cp $SRC/it/description.txt    $DES/description-it.txt
cp $SRC/ja/description.txt    $DES/description-ja.txt
cp $SRC/ko/description.txt    $DES/description-ko.txt
cp $SRC/lt/description.txt    $DES/description-lt.txt
cp $SRC/lv/description.txt    $DES/description-lv.txt
cp $SRC/ms/description.txt    $DES/description-ms.txt
cp $SRC/mr/description.txt    $DES/description-mr.txt
cp $SRC/no/description.txt    $DES/description-no.txt
cp $SRC/nl/description.txt    $DES/description-nl.txt
cp $SRC/pl/description.txt    $DES/description-pl.txt
cp $SRC/pt-BR/description.txt $DES/description-pt_BR.txt
cp $SRC/pt-PT/description.txt $DES/description-pt_PT.txt
cp $SRC/ro/description.txt    $DES/description-ro.txt
cp $SRC/ru/description.txt    $DES/description-ru.txt
cp $SRC/sk/description.txt    $DES/description-sk.txt
cp $SRC/sl/description.txt    $DES/description-sl.txt
cp $SRC/sq/description.txt    $DES/description-sq.txt
cp $SRC/sr/description.txt    $DES/description-sr.txt
cp $SRC/sv-SE/description.txt $DES/description-sv.txt
cp $SRC/ta/description.txt    $DES/description-ta.txt
cp $SRC/te/description.txt    $DES/description-te.txt
cp $SRC/tr/description.txt    $DES/description-tr.txt
cp $SRC/uk/description.txt    $DES/description-uk.txt
cp $SRC/vi/description.txt    $DES/description-vi.txt
cp $SRC/zh-CN/description.txt $DES/description-zh_CN.txt
cp $SRC/zh-TW/description.txt $DES/description-zh_TW.txt


#rm -r $SRC
