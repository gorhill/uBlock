#!/bin/sh

DO_FIREFOX=true
DO_CHROME=true
DO_OPERA=true
DO_EDGE=true

# Different Operating Systems
case "$(uname -sr)" in
  Darwin*)
    echo 'Mac OS X'
    CHROME=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
    FIREFOX=/Applications/Firefox.app/Contents/MacOS/firefox
    OPERA=/Applications/Opera.app/Contents/MacOS/Opera 
    ;;
  Linux*)
    echo 'Linux'
    # to-do 
    CHROME=chrome
    FIREFOX=firefox
    OPERA=opera
    # add here paths for linux
    ;;
  CYGWIN*|MINGW*|MINGW32*|MSYS*)
    echo 'MS Windows'
    # to-do 
    # add here paths for windows
    ;;
esac

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
rm -rf ${DES}/adnauseam.*


if [[ $DO_EDGE = false && $DO_CHROME = false && $DO_OPERA = false && $DO_FIREFOX = false ]]; 
then
    echo "FATAL: No actions specified \\n"
    exit 
fi

if [[ $DO_EDGE = true && $DO_CHROME = false ]]; 
then
    echo "FATAL: Edge build requires Chromium as well\\n"
    exit 
fi

# CHROME (ZIP/CRX)
if [ $DO_CHROME = true ]
then
  printf '%s' "*** Target -> "
  command "${CHROME}" --version || { echo >&2 "Chrome is not installed."; exit 1; }
  ./tools/make-chromium.sh
  "${CHROME}" "${CHROME_OPTS}"
  mv ${DES}/adnauseam.chromium.crx ${ARTS}/adnauseam-${VERSION}.chromium.crx
  cd ${DES} > /dev/null 2>&1
  zip -9 -r -q --exclude=*.DS_Store* ../../artifacts/adnauseam-${VERSION}.chromium.zip adnauseam.chromium
  cp ../../artifacts/adnauseam-${VERSION}.chromium.zip ../../artifacts/adnauseam.chromium.zip
  cd - > /dev/null 2>&1
fi

# OPERA (CRX)
if [ $DO_OPERA = true ]
then
  printf "*** Target -> Opera " && command "${OPERA}" --version || { echo >&2 "Opera is not installed."; exit 1; }
  ./tools/make-opera.sh
  "${OPERA}" "${OPERA_OPTS}" &> /dev/null
  mv ${DES}/adnauseam.opera.crx ${ARTS}/adnauseam-${VERSION}.opera.crx
fi


# EDGE (ZIP)
if [ $DO_EDGE = true ]
then
  printf "\n*** Target -> Edge\n"
  ./tools/make-edge.sh
  cat <<< $(jq 'del(.key)' $DES/adnauseam.edge/manifest.json) > $DES/adnauseam.edge/manifest.json
  web-ext build -s ${DES}/adnauseam.edge -a ${ARTS}
  mv ${ARTS}/adnauseam-${VERSION}.zip ${ARTS}/adnauseam-${VERSION}.edge.zip
fi


# FIREFOX (ZIP)
if [ $DO_FIREFOX = true ]
then
  printf '\n%s' "*** Target -> "
  # command "${FIREFOX}" -v || { echo >&2 "Firefox is not installed."; exit 1; }
  ./tools/make-firefox.sh all
  web-ext build -s ${DES}/adnauseam.firefox -a ${ARTS}
  mv ${ARTS}/adnauseam-${VERSION}.zip ${ARTS}/adnauseam-${VERSION}.firefox.zip
fi


echo

#ls -l artifacts
open $ARTS
