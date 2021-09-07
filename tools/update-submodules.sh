#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** Update submodules"

git submodule update --remote
if [[ $(git diff ./submodules/) ]]; then
    git add -u submodules/
    git commit -m 'Update submodules'
    git push origin master
    echo "*** Submodules updated"
else
    echo "*** Submodules are already up to date"
fi
