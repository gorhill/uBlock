#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e
shopt -s extglob

echo "*** uBOLite.mv3: Creating extension"

PLATFORM="chromium"

for i in "$@"; do
  case $i in
    quick)
      QUICK="yes"
      ;;
    full)
      FULL="yes"
      ;;
    firefox)
      PLATFORM="firefox"
      ;;
    chromium)
      PLATFORM="chromium"
      ;;
    uBOLite_+([0-9]).+([0-9]).+([0-9]).+([0-9]))
      TAGNAME="$i"
      FULL="yes"
      ;;
    before=+([[:print:]]))
      BEFORE="${i:7}"
      ;;
  esac
done

echo "PLATFORM=$PLATFORM"
echo "TAGNAME=$TAGNAME"
echo "BEFORE=$BEFORE"

DES="dist/build/uBOLite.$PLATFORM"

if [ "$QUICK" != "yes" ]; then
    rm -rf $DES
fi

mkdir -p $DES
cd $DES
DES=$(pwd)
cd - > /dev/null

mkdir -p "$DES"/css/fonts
mkdir -p "$DES"/js
mkdir -p "$DES"/img

if [ -n "$UBO_VERSION" ]; then
    UBO_REPO="https://github.com/gorhill/uBlock.git"
    UBO_DIR=$(mktemp -d)
    echo "*** uBOLite.mv3: Fetching uBO $UBO_VERSION from $UBO_REPO into $UBO_DIR"
    cd "$UBO_DIR"
    git init -q
    git remote add origin "https://github.com/gorhill/uBlock.git"
    git fetch --depth 1 origin "$UBO_VERSION"
    git checkout -q FETCH_HEAD
    cd - > /dev/null
else
    UBO_DIR=.
fi

echo "*** uBOLite.mv3: Copying common files"
cp -R "$UBO_DIR"/src/css/fonts/* "$DES"/css/fonts/
cp "$UBO_DIR"/src/css/themes/default.css "$DES"/css/
cp "$UBO_DIR"/src/css/common.css "$DES"/css/
cp "$UBO_DIR"/src/css/dashboard-common.css "$DES"/css/
cp "$UBO_DIR"/src/css/fa-icons.css "$DES"/css/

cp "$UBO_DIR"/src/js/dom.js "$DES"/js/
cp "$UBO_DIR"/src/js/fa-icons.js "$DES"/js/
cp "$UBO_DIR"/src/js/i18n.js "$DES"/js/
cp "$UBO_DIR"/src/js/urlskip.js "$DES"/js/
cp "$UBO_DIR"/src/lib/punycode.js "$DES"/js/

cp -R "$UBO_DIR/src/img/flags-of-the-world" "$DES"/img

cp LICENSE.txt "$DES"/

echo "*** uBOLite.mv3: Copying mv3-specific files"
if [ "$PLATFORM" = "firefox" ]; then
    cp platform/mv3/firefox/background.html "$DES"/
fi
cp platform/mv3/extension/*.html "$DES"/
cp platform/mv3/extension/*.json "$DES"/
cp platform/mv3/extension/css/* "$DES"/css/
cp -R platform/mv3/extension/js/* "$DES"/js/
cp platform/mv3/extension/img/* "$DES"/img/
cp -R platform/mv3/extension/_locales "$DES"/
cp platform/mv3/README.md "$DES/"

if [ "$QUICK" != "yes" ]; then
    echo "*** uBOLite.mv3: Generating rulesets"
    TMPDIR=$(mktemp -d)
    mkdir -p "$TMPDIR"
    if [ "$PLATFORM" = "chromium" ]; then
        cp platform/mv3/chromium/manifest.json "$DES"/
    elif [ "$PLATFORM" = "firefox" ]; then
        cp platform/mv3/firefox/manifest.json "$DES"/
    fi
    ./tools/make-nodejs.sh "$TMPDIR"
    cp platform/mv3/package.json "$TMPDIR"/
    cp platform/mv3/*.js "$TMPDIR"/
    cp platform/mv3/*.mjs "$TMPDIR"/
    cp platform/mv3/extension/js/utils.js "$TMPDIR"/js/
    cp -R "$UBO_DIR"/src/js/resources "$TMPDIR"/js/
    cp "$UBO_DIR"/assets/assets.dev.json "$TMPDIR"/
    cp -R platform/mv3/scriptlets "$TMPDIR"/
    mkdir -p "$TMPDIR"/web_accessible_resources
    cp "$UBO_DIR"/src/web_accessible_resources/* "$TMPDIR"/web_accessible_resources/
    cd "$TMPDIR"
    node --no-warnings make-rulesets.js output="$DES" platform="$PLATFORM"
    if [ -n "$BEFORE" ]; then
        echo "*** uBOLite.mv3: salvaging rule ids to minimize diff size"
        echo "    before=$BEFORE/$PLATFORM"
        echo "    after=$DES"
        node salvage-ruleids.mjs before="$BEFORE"/"$PLATFORM" after="$DES"
    fi
    cd - > /dev/null
    rm -rf "$TMPDIR"
fi

echo "*** uBOLite.mv3: extension ready"
echo "Extension location: $DES/"

# Local build
if [ -z "$TAGNAME" ]; then
    # Enable DNR rule debugging
    tmp=$(mktemp)
    jq '.permissions += ["declarativeNetRequestFeedback"]' \
        "$DES/manifest.json" > "$tmp" \
        && mv "$tmp" "$DES/manifest.json"
    # Use a different extension id than the official one
    if [ "$PLATFORM" = "firefox" ]; then
        tmp=$(mktemp)
        jq '.browser_specific_settings.gecko.id = "uBOLite.dev@raymondhill.net"' "$DES/manifest.json"  > "$tmp" \
            && mv "$tmp" "$DES/manifest.json"
    fi
fi

if [ "$FULL" = "yes" ]; then
    EXTENSION="zip"
    if [ "$PLATFORM" = "firefox" ]; then
        EXTENSION="xpi"
    fi
    echo "*** uBOLite.mv3: Creating publishable package..."
    if [ -z "$TAGNAME" ]; then
        TAGNAME="uBOLite_$(jq -r .version "$DES"/manifest.json)"
    else
        tmp=$(mktemp)
        jq --arg version "${TAGNAME:8}" '.version = $version' "$DES/manifest.json"  > "$tmp" \
            && mv "$tmp" "$DES/manifest.json"
    fi
    PACKAGENAME="$TAGNAME.$PLATFORM.mv3.$EXTENSION"
    TMPDIR=$(mktemp -d)
    mkdir -p "$TMPDIR"
    cp -R "$DES"/* "$TMPDIR"/
    cd "$TMPDIR" > /dev/null
    rm -f ./log.txt
    zip "$PACKAGENAME" -qr ./*
    cd - > /dev/null
    cp "$TMPDIR"/"$PACKAGENAME" dist/build/
    rm -rf "$TMPDIR"
    echo "Package location: $(pwd)/dist/build/$PACKAGENAME"
fi
