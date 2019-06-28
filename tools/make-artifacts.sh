#!/bin/sh

CHROME=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
FIREFOX=/Applications/Firefox.app/Contents/MacOS/firefox-bin
OPERA=/Applications/Opera.app/Contents/MacOS/Opera

#CHROME_PEM=./adnauseam.chromium.pem

# before running, check for dependencies, if not, exit with error
hash web-ext 2>/dev/null || { echo >&2 "Webext is not installed. Please do npm install --global web-ext."; exit 1; }
echo

DES=dist/build
ARTS=artifacts

CHROME_OPTS=--pack-extension=${DES}/adnauseam.chromium
OPERA_OPTS=--pack-extension=${DES}/adnauseam.opera

VERSION=`jq .version manifest.json | tr -d '"'`


# CLEAN
rm -rf ${ARTS}
mkdir ${ARTS}
rm -rf ${DES}/*


# CHROME
printf '%s' "*** Target -> "
command "${CHROME}" --version || { echo >&2 "Chrome is not installed."; exit 1; }
./tools/make-chromium.sh

# OPERA
printf "*** Target -> Opera " && command "${OPERA}" --version || { echo >&2 "Opera is not installed."; exit 1; }
./tools/make-opera.sh
"${OPERA}" "${OPERA_OPTS}"
mv ${DES}/adnauseam.opera.crx ${ARTS}/adnauseam-${VERSION}.opera.crx


# FIREFOX
printf '%s' "*** Target -> "
command "${FIREFOX}" -v || { echo >&2 "Firefox is not installed."; exit 1; }
./tools/make-firefox.sh all
web-ext build -s ${DES}/adnauseam.firefox -a ${ARTS}
mv ${ARTS}/adnauseam-${VERSION}.zip ${ARTS}/adnauseam-${VERSION}.firefox.zip


# CHROME-RAW
cd ${DES}
zip -9 -r -q --exclude=*.DS_Store* ../../artifacts/adnauseam-${VERSION}.chromium.zip adnauseam.chromium
cd -


# NO PEMS
mv ${DES}/*.pem /tmp

echo
ls -l artifacts
open artifacts
