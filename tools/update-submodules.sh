#!/usr/bin/env bash -e
#
# This script assumes a linux environment

echo "*** Update submodules"

git submodule update --remote
if [ `git diff --quiet ./submodules/` ]; then
    git add -u submodules/
    git commit -m 'Update submodules'
    git push origin master
    echo "*** Submodules updated"
else
    echo "*** Submodules are already up to date"
fi
