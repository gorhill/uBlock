#!/bin/sh

CHROME=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
FIREFOX=/Applications/FirefoxDeveloperEdition.app/Contents/MacOS/firefox-bin
OPERA=/Applications/Opera.app/Contents/MacOS/Opera

DES=dist/build
ARTS=artifacts

CHROME_OPTS=--pack-extension=${DES}/adnauseam.chromium
OPERA_OPTS=--pack-extension=${DES}/adnauseam.opera

VERSION=`jq .version manifest.json | tr -d '"'`


# CLEAN
rm -rf ${ARTS}/*
rm -rf ${DES}/*


# CHROME
./tools/make-chromium.sh
"${CHROME}" "${CHROME_OPTS}"
mv ${DES}/adnauseam.chromium.crx ${ARTS}/adnauseam-${VERSION}.chromium.crx


# OPERA
./tools/make-opera.sh
"${OPERA}" "${OPERA_OPTS}"
mv ${DES}/adnauseam.opera.nex ${ARTS}/adnauseam-${VERSION}.opera.nex


# FIREFOX
./tools/make-firefox.sh
pushd ${DES}/adnauseam.firefox
jpm xpi
popd
cp ${DES}/adnauseam.firefox/null.xpi ${ARTS}/adnauseam-${VERSION}.firefox.xpi


# WEBEXT
./tools/make-webext.sh all
web-ext build -s ${DES}/adnauseam.webext -a ${ARTS}
mv ${ARTS}/adnauseam-${VERSION}.zip ${ARTS}/adnauseam-${VERSION}.webext.zip


# CHROME-RAW
cd dist/build
zip -9 -r -q --exclude=*.DS_Store* ../../artifacts/adnauseam-${VERSION}.chromium.zip adnauseam.chromium
cd -

# NO PEMS
mv ${DES}/*.pem /tmp

ls -l artifacts
open artifacts
