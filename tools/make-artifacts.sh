#!/bin/sh

CHROME=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
FIREFOX=/Applications/FirefoxNightly.app/Contents/MacOS/firefox-bin
OPERA=/Applications/Opera.app/Contents/MacOS/Opera

CHROME_PEM=./adnauseam.chromium.pem

# before running, check that above programs exist, as well as that 'webext' cmd exists
# if not, exit with error
command "${CHROME}" --version || { echo >&2 "Chrome is not installed."; exit 1; }
command "${FIREFOX}" -v || { echo >&2 "Firefox is not installed."; exit 1; }
command "${OPERA}" --version || { echo >&2 "Opera is not installed."; exit 1; }
hash web-ext 2>/dev/null || { echo >&2 "Webext is not installed. Please do npm install --global web-ext."; exit 1; }


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
./tools/make-chromium.sh
if [ -f $CHROME_PEM ]; then  # do we have the signing key?
  "${CHROME}" "${CHROME_OPTS}" "--pack-extension-key $CHROME_PEM"
  mv ${DES}/adnauseam.chromium.crx ${ARTS}/adnauseam-${VERSION}.chromium.crx
  echo "*** AdNauseam::Chromium: Signed with local .pem\\n"
else
  "${CHROME}" "${CHROME_OPTS}"
  mv ${DES}/adnauseam.chromium.crx ${ARTS}/adnauseam-${VERSION}.chromium-UNSIGNED.crx
  echo "WARN: NO .pem key found for Chrome build, this is required for publishing\\n"
fi


# OPERA
./tools/make-opera.sh
"${OPERA}" "${OPERA_OPTS}"
mv ${DES}/adnauseam.opera.nex ${ARTS}/adnauseam-${VERSION}.opera.nex


# FIREFOX
./tools/make-firefox.sh
pushd ${DES}/adnauseam.firefox
jpm xpi
popd
cp ${DES}/adnauseam.firefox/null.xpi ${ARTS}/adnauseam-${VERSION}.firefox-legacy.xpi


# WEBEXT
./tools/make-webext.sh all
web-ext build -s ${DES}/adnauseam.webext -a ${ARTS}
mv ${ARTS}/adnauseam-${VERSION}.zip ${ARTS}/adnauseam-${VERSION}.firefox.zip

# CHROME-RAW
cd ${DES}
zip -9 -r -q --exclude=*.DS_Store* ../../artifacts/adnauseam-${VERSION}.chromium.zip adnauseam.chromium
cd -

# NO PEMS
mv ${DES}/*.pem /tmp

ls -l artifacts
open artifacts
