#!/bin/bash

# This script requires a grep that supports the -P option
# ~f you are on OSX, you can install such a grep as follows:
#
#    $ brew install homebrew/dupes/grep --with-default-names
#

# fix-filenames.pl

mkdir -p other

for f in *; do 

    if [ -d "$f" ]
    then
      echo Skipping directory \'$f\'
      continue
    fi

    if [ ${f: -4} == ".svg" ]
    then
      echo Skipping svg \'$f\'
      continue
    fi

    type=$( file "$f" | grep -oP '\w+(?= image data)' )
    #echo checking $f $type
    case $type in  
        PNG)  newext=png ;; 
        GIF)  newext=gif ;; 
        JPEG) newext=jpg ;; 
        *)    echo "*** Moving $f ($( file "$f" | awk '{print $2;}' ))"; mv $f other/; continue ;; 
    esac

    ext=${f##*.}   # remove ext

    if [[ $ext != $newext ]]; then
        echo mv "$f" "${f%.*}.$newext"
        mv "$f" "${f%.*}.$newext"
    fi
done

