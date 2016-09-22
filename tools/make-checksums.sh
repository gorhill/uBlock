#!/usr/bin/env bash
#
# This script assumes a linux environment

DES=/tmp

if hash md5sum 2>/dev/null; then

 echo Pulling uAssets...
 cd ../uAssets && git fetch upstream && git merge upstream/master && cd -

 echo Copying ../uAssets/checksums/ublock0.txt to $DES/checksums.txt
 cp ../uAssets/checksums/ublock0.txt $DES/checksums.txt
 ENTRY=assets/ublock/adnauseam.txt
 CS="`md5sum -q $ENTRY` $ENTRY"

 echo Adding  \"$CS\" to $DES/checksums.txt
 echo $CS >> $DES/checksums.txt    # for build

 echo Writing \"$CS\" to assets/checksum-adn.txt
 echo $CS > assets/checksum-adn.txt # to store

else
  echo; echo [FATAL] requires 'md5sum', which appears not to be installed; echo
  exit
fi

echo Writing $DES/checksums.txt to ./assets/checksums/ublock0.txt
cp $DES/checksums.txt ./assets/checksums/ublock0.txt  # for checking in adn repo

echo "Done"; echo

#cat ./assets/checksums.txt
