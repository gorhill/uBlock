#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** adnauseam.firefox: Copying files"

DES=dist/build/adnauseam.firefox
rm -rf $DES
mkdir -p $DES

cp -R assets                            $DES/
rm    $DES/assets/*.sh
cp -R src/css                           $DES/
cp -R src/img                           $DES/
cp -R src/js                            $DES/
cp -R src/lib                           $DES/
cp -R src/_locales                      $DES/
cp    src/*.html                        $DES/

# AMO review feedback: avoid "unnecessary files or folders" in package
cat   src/background.html | sed -e '/vapi-polyfill\.js/d' > $DES/background.html

mv    $DES/img/icon_128.png             $DES/icon.png
cp    platform/firefox/css/*            $DES/css/
cp    platform/firefox/vapi-*.js        $DES/js/
cp    platform/firefox/bootstrap.js     $DES/
cp    platform/firefox/frame*.js        $DES/
cp -R platform/firefox/img              $DES/
cp    platform/firefox/chrome.manifest  $DES/

cp    platform/firefox/install.rdf      $DES/
#cp    tools/adn/firefox/install.rdf    $DES/ #adn

cp    platform/firefox/*.xul            $DES/
cp    LICENSE.txt                       $DES/

echo "*** adnauseam.firefox: Generating meta..."
python tools/make-firefox-meta-adn.py $DES/ "$2"  #adn

if [ "$1" = all ]; then
    echo "*** adnauseam.firefox: Creating package..."
    pushd $DES/
    zip ../adnauseam.firefox.xpi -qr *
    popd
fi

echo "*** adnauseam.firefox: Package done."
