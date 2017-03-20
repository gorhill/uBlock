#/bin/sh

set -e # die on errors 


if [ $# -lt "1"  ]
then
    echo
    echo "  error:   tag or version required"
    echo
    echo "  usage:   tag-release.sh [1.3.9]" 
    exit
fi

VERSION=$1

# add changed files, but not new files
git add -u .
#git add -A .

# commit your changes
git commit -m "Release v$VERSION"

# tag the commit
git tag -a v$VERSION -m "Release v$VERSION"

# push to GitHub
#git push --force origin master --tags  
#git push --force origin master && git push --tags
#git push && git push --tags
git push && git push origin v$VERSION

