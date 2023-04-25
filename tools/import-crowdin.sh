#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** uBlock: Importing from Crowdin archive"

SRC=~/Downloads/crowdin
rm -r $SRC || true > /dev/null
unzip -q ~/Downloads/uBlock\ \(translations\).zip -d $SRC

# https://www.assertnotmagic.com/2018/06/20/bash-brackets-quick-reference/

DES=./src/_locales
DESMV3=./platform/mv3/extension/_locales

for dir in $SRC/*/; do
  srclang=$(basename $dir)
  deslang=${srclang/-/_}
  deslang=${deslang%_AM}
  deslang=${deslang%_ES}
  deslang=${deslang%_IN}
  deslang=${deslang%_LK}
  deslang=${deslang%_NL}
  deslang=${deslang%_PK}
  deslang=${deslang%_SE}
  if [[ $deslang == 'en' ]]; then
    continue
  fi
  # ubo
  mkdir -p "$DES/$deslang/" && cp "$SRC/$srclang/messages.json" "$DES/$deslang/"
  # ubo lite
  mkdir -p "$DESMV3/$deslang/" && cp "$SRC/$srclang/uBO-Lite/messages.json" "$DESMV3/$deslang/"
  # descriptions
  #cp "$SRC/$srclang/description.txt" "./dist/description/description-${deslang}.txt"
  cp "$SRC/$srclang/uBO-Lite/webstore.txt" "./platform/mv3/description/webstore.$deslang.txt"
done

# Output files with possible misuse of `$`, as this can lead to severe
# consequences, such as not being able to run the extension at all.
# uBO does not use `$`, so any instance of `$` must be investigated.
# See https://issues.adblockplus.org/ticket/6666
echo "*** uBlock: Instances of '\$':"
grep -FR "$" $DES/ || true
grep -FR "$" $DESMV3/ || true


rm -r $SRC
echo "*** uBlock: Import done."
git status
