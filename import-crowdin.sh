#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock: Importing from Crowdin archive"
rm -r ~/Downloads/crowdin
unzip -q ~/Downloads/ublock.zip -d ~/Downloads/crowdin
cp ~/Downloads/crowdin/ar/messages.json    ./_locales/ar/messages.json
cp ~/Downloads/crowdin/cs/messages.json    ./_locales/cs/messages.json
cp ~/Downloads/crowdin/da/messages.json    ./_locales/da/messages.json
cp ~/Downloads/crowdin/es-ES/messages.json ./_locales/es/messages.json
cp ~/Downloads/crowdin/et/messages.json    ./_locales/et/messages.json
cp ~/Downloads/crowdin/fi/messages.json    ./_locales/fi/messages.json
cp ~/Downloads/crowdin/he/messages.json    ./_locales/he/messages.json
cp ~/Downloads/crowdin/hr/messages.json    ./_locales/hr/messages.json
cp ~/Downloads/crowdin/hu/messages.json    ./_locales/hu/messages.json
cp ~/Downloads/crowdin/id/messages.json    ./_locales/id/messages.json
cp ~/Downloads/crowdin/it/messages.json    ./_locales/it/messages.json
cp ~/Downloads/crowdin/ja/messages.json    ./_locales/ja/messages.json
cp ~/Downloads/crowdin/no/messages.json    ./_locales/nb/messages.json
cp ~/Downloads/crowdin/nl/messages.json    ./_locales/nl/messages.json
cp ~/Downloads/crowdin/pl/messages.json    ./_locales/pl/messages.json
cp ~/Downloads/crowdin/pt-BR/messages.json ./_locales/pt_BR/messages.json
cp ~/Downloads/crowdin/pt-PT/messages.json ./_locales/pt_PT/messages.json
cp ~/Downloads/crowdin/ro/messages.json    ./_locales/ro/messages.json
cp ~/Downloads/crowdin/ru/messages.json    ./_locales/ru/messages.json
cp ~/Downloads/crowdin/sv-SE/messages.json ./_locales/sv/messages.json
cp ~/Downloads/crowdin/tr/messages.json    ./_locales/tr/messages.json
cp ~/Downloads/crowdin/uk/messages.json    ./_locales/uk/messages.json
cp ~/Downloads/crowdin/vi/messages.json    ./_locales/vi/messages.json
cp ~/Downloads/crowdin/zh-CN/messages.json ./_locales/zh_CN/messages.json
rm -r ~/Downloads/crowdin
echo "*** uBlock: Import done."
