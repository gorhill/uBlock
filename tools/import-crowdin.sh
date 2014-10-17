#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock: Importing from Crowdin archive"
rm -r ~/Downloads/crowdin
unzip -q ~/Downloads/ublock.zip -d ~/Downloads/crowdin
cp ~/Downloads/crowdin/ar/messages.json    ../src/_locales/ar/messages.json
cp ~/Downloads/crowdin/cs/messages.json    ../src/_locales/cs/messages.json
cp ~/Downloads/crowdin/da/messages.json    ../src/_locales/da/messages.json
cp ~/Downloads/crowdin/el/messages.json    ../src/_locales/el/messages.json
cp ~/Downloads/crowdin/es-ES/messages.json ../src/_locales/es/messages.json
cp ~/Downloads/crowdin/et/messages.json    ../src/_locales/et/messages.json
cp ~/Downloads/crowdin/fi/messages.json    ../src/_locales/fi/messages.json
cp ~/Downloads/crowdin/he/messages.json    ../src/_locales/he/messages.json
cp ~/Downloads/crowdin/hi/messages.json    ../src/_locales/hi/messages.json
cp ~/Downloads/crowdin/hr/messages.json    ../src/_locales/hr/messages.json
cp ~/Downloads/crowdin/hu/messages.json    ../src/_locales/hu/messages.json
cp ~/Downloads/crowdin/id/messages.json    ../src/_locales/id/messages.json
cp ~/Downloads/crowdin/it/messages.json    ../src/_locales/it/messages.json
cp ~/Downloads/crowdin/ja/messages.json    ../src/_locales/ja/messages.json
cp ~/Downloads/crowdin/mr/messages.json    ../src/_locales/mr/messages.json
cp ~/Downloads/crowdin/no/messages.json    ../src/_locales/nb/messages.json
cp ~/Downloads/crowdin/nl/messages.json    ../src/_locales/nl/messages.json
cp ~/Downloads/crowdin/pl/messages.json    ../src/_locales/pl/messages.json
cp ~/Downloads/crowdin/pt-BR/messages.json ../src/_locales/pt_BR/messages.json
cp ~/Downloads/crowdin/pt-PT/messages.json ../src/_locales/pt_PT/messages.json
cp ~/Downloads/crowdin/ro/messages.json    ../src/_locales/ro/messages.json
cp ~/Downloads/crowdin/ru/messages.json    ../src/_locales/ru/messages.json
cp ~/Downloads/crowdin/sv-SE/messages.json ../src/_locales/sv/messages.json
cp ~/Downloads/crowdin/tr/messages.json    ../src/_locales/tr/messages.json
cp ~/Downloads/crowdin/uk/messages.json    ../src/_locales/uk/messages.json
cp ~/Downloads/crowdin/vi/messages.json    ../src/_locales/vi/messages.json
cp ~/Downloads/crowdin/zh-CN/messages.json ../src/_locales/zh_CN/messages.json

#

cp ~/Downloads/crowdin/ar/description.txt    ../dist/description/description-ar.txt
cp ~/Downloads/crowdin/cs/description.txt    ../dist/description/description-cs.txt
cp ~/Downloads/crowdin/da/description.txt    ../dist/description/description-da.txt
#cp ~/Downloads/crowdin/el/description.txt    ../dist/description/description-el.txt
cp ~/Downloads/crowdin/es-ES/description.txt ../dist/description/description-es.txt
cp ~/Downloads/crowdin/et/description.txt    ../dist/description/description-et.txt
cp ~/Downloads/crowdin/fi/description.txt    ../dist/description/description-fi.txt
cp ~/Downloads/crowdin/he/description.txt    ../dist/description/description-he.txt
cp ~/Downloads/crowdin/hr/description.txt    ../dist/description/description-hr.txt
cp ~/Downloads/crowdin/hu/description.txt    ../dist/description/description-hu.txt
cp ~/Downloads/crowdin/id/description.txt    ../dist/description/description-id.txt
cp ~/Downloads/crowdin/it/description.txt    ../dist/description/description-it.txt
#cp ~/Downloads/crowdin/ja/description.txt    ../dist/description/description-ja.txt
cp ~/Downloads/crowdin/no/description.txt    ../dist/description/description-no.txt
cp ~/Downloads/crowdin/nl/description.txt    ../dist/description/description-nl.txt
cp ~/Downloads/crowdin/pl/description.txt    ../dist/description/description-pl.txt
cp ~/Downloads/crowdin/pt-BR/description.txt ../dist/description/description-pt_BR.txt
cp ~/Downloads/crowdin/pt-PT/description.txt ../dist/description/description-pt_PT.txt
cp ~/Downloads/crowdin/ro/description.txt    ../dist/description/description-ro.txt
cp ~/Downloads/crowdin/ru/description.txt    ../dist/description/description-ru.txt
cp ~/Downloads/crowdin/sv-SE/description.txt ../dist/description/description-sv.txt
cp ~/Downloads/crowdin/tr/description.txt    ../dist/description/description-tr.txt
cp ~/Downloads/crowdin/uk/description.txt    ../dist/description/description-uk.txt
#cp ~/Downloads/crowdin/vi/description.txt    ../dist/description/description-vi.txt
cp ~/Downloads/crowdin/zh-CN/description.txt ../dist/description/description-zh_CN.txt

#

rm -r ~/Downloads/crowdin
echo "*** uBlock: Import done."
