#!/usr/bin/env bash
#
# This script assumes a linux environment

DES=/tmp

if hash md5sum 2>/dev/null; then
 echo copying ../uAssets/checksums/ublock0.txt to $DES/checksums.txt
 cp ../uAssets/checksums/ublock0.txt $DES/checksums.txt
 ENTRY=assets/ublock/adnauseam.txt
 CS="`md5sum -q $ENTRY` $ENTRY"
 echo appending \"$CS\" to $DES/checksums.txt
 echo $CS >> $DES/checksums.txt    # for build
 echo writing \"$CS\" to assets/checksum-adn.txt
 echo $CS > assets/checksum-adn.txt # to store
else
  echo requires md5sum, which appears not to be installed
  exit
fi

echo writing $DES/checksums.txt to ./assets/checksums/ublock0.txt
cp $DES/checksums.txt ./assets/checksums/ublock0.txt  # for checking in adn repo

echo "done."

cat ./assets/checksums.txt
