#!/bin/bash

# This script requires a grep that supports the -P option
# ~f you are on OSX, you can install such a grep as follows:
#
#    $ brew install homebrew/dupes/grep --with-default-names
#

#set -e

# replace spaces with underscores
#find . -name "* *" -type f | rename 's/ +/_/g'

for f in *; do 
    type=$( file "$f" | grep -oP '\w+(?= image data)' )
    #echo checking $f $type
    case $type in  
        PNG)  newext=png ;; 
        GIF)  newext=gif ;; 
        JPEG) newext=jpg ;; 
        *)    echo "*** SKIPPING $f ($( file "$f" | awk '{print $2;}' ))"; continue ;; 
    esac

    ext=${f##*.}   # remove ext

    if [[ $ext != $newext ]]; then
        echo mv "$f" "${f%.*}.$newext"
        mv "$f" "${f%.*}.$newext"
    fi
done

