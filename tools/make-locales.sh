#!/usr/bin/env bash
#
# This script assumes a linux environment

DES=$1

hash jq 2>/dev/null || { echo; echo >&2 "Error: this script requires jq (https://stedolan.github.io/jq/), but it's not installed"; exit 1; }

printf "*** Generating locale files in $DES... "

FILES=src/_locales/**/adnauseam.json
for adnfile in $FILES
do
  messages="${adnfile/adnauseam/messages}"
  out="${messages/src/$DES}"
  dir=`dirname $out`
  mkdir -p $dir && touch $out
  #echo Writing $out
  jq -s '.[0] * .[1]' $messages $adnfile > $out
done

echo "done."
