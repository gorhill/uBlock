#!/usr/bin/env bash
#
# This script assumes an OS X or *NIX environment

echo '*** uBlock0.safariextension: Copying files...'

DES=dist/build/uBlock0.safariextension
rm -rf $DES
mkdir -p $DES

# Delete .DS_Store before making
find . ../uAssets -name '.DS_Store' -type f -delete

bash ./tools/make-assets.sh       $DES

cp -R src/css                     $DES/
cp -R src/img                     $DES/
cp -R src/js                      $DES/
cp -R src/lib                     $DES/
cp -R src/_locales                $DES/
cp src/*.html                     $DES/
mv $DES/img/icon_128.png          $DES/Icon.png
cp platform/safari/*.js           $DES/js/
cp platform/safari/*.html         $DES/
cp -R platform/safari/img         $DES/
cp platform/safari/Info.plist     $DES/
cp platform/safari/Settings.plist $DES/
cp LICENSE.txt                    $DES/

# https://github.com/el1t/uBlock-Safari/issues/4
echo '*** uBlock0.safariextension: Adding extensions to extensionless assets...'
find $DES/assets/thirdparties -type f -regex '.*\/[^.]*' -exec mv {} {}.txt \;

# Declare __MSG__ scripts inside client-injected.js
# Beware: this removes all newlines within each script
echo '*** uBlock0.safariextension: Injecting scripts into vapi-client...'
awkscript='BEGIN { p = 0 }
/^\/\/ __MSG__/ {
  p = 1
  next
}
/^\/\/ __MSG_[A-Za-z_]+__/ && p { exit 0 }
/^[ ]*\/\// { next }
/^[ ]*[^\/]{2}/ && p {
  sub(/^[ ]+/, "", $0)
  gsub(/\\/, "\\\\")
  gsub(/'"'"'/, "\\'"'"'")
  printf "%s", $0
}'
declare -a sedargs=('-i' '')
for message in $(perl -nle '/^\/\/ (__MSG_[A-Za-z]+__)/ && print $1' < $DES/js/client-injected.js); do
    script=$(awk "${awkscript/__MSG__/${message}}" $DES/js/client-injected.js | sed 's/[\"#&]/\\&/g')
    sedargs+=('-e' "s#${message}#${script}#")
done
if ! sed "${sedargs[@]}" $DES/js/vapi-client.js 2>/dev/null; then
    sed ${sedargs[@]} $DES/js/vapi-client.js
fi
rm -f $DES/js/client-injected.js

echo '*** uBlock0.safariextension: Generating Info.plist...'
python tools/make-safari-meta.py $DES/

if [ "$1" = all ]; then
    if [ ! -f dist/certs/key.pem ] || [ ! -f dist/certs/SafariDeveloper.cer ]; then
        echo '*** uBlock0.safariextension: Cannot sign extension; missing credentials'
        exit 1
    fi
    echo -n '*** uBlock0.safariextension: Creating signed extension...'
    if ! bash ./tools/make-safari-sign.sh "$DES"; then
        echo '*** uBlock0.safariextension: Error signing extension'
        exit 1
    fi
    echo ' done.'
fi

echo '*** uBlock0.safariextension: Done.'

