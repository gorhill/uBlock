#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e
shopt -s extglob

echo "*** uBOLite.mv3: Creating extension"

PLATFORM="chromium"

for i in "$@"; do
  case $i in
    full)
      FULL="yes"
      ;;
    firefox)
      PLATFORM="firefox"
      ;;
    chromium)
      PLATFORM="chromium"
      ;;
    edge)
      PLATFORM="edge"
      ;;
    safari)
      PLATFORM="safari"
      ;;
    +([0-9]).+([0-9]).+([0-9]))
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

UBOL_DIR="dist/build/uBOLite.$PLATFORM"

if [ "$PLATFORM" = "edge" ]; then
    MANIFEST_DIR="chromium"
else
    MANIFEST_DIR="$PLATFORM"
fi

rm -rf $UBOL_DIR

mkdir -p $UBOL_DIR
cd $UBOL_DIR
UBOL_DIR=$(pwd)
cd - > /dev/null

mkdir -p "$UBOL_DIR"/css/fonts
mkdir -p "$UBOL_DIR"/js
mkdir -p "$UBOL_DIR"/img

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
cp -R "$UBO_DIR"/src/css/fonts/Inter "$UBOL_DIR"/css/fonts/
cp "$UBO_DIR"/src/css/themes/default.css "$UBOL_DIR"/css/
cp "$UBO_DIR"/src/css/common.css "$UBOL_DIR"/css/
cp "$UBO_DIR"/src/css/dashboard-common.css "$UBOL_DIR"/css/
cp "$UBO_DIR"/src/css/fa-icons.css "$UBOL_DIR"/css/

cp "$UBO_DIR"/src/js/arglist-parser.js "$UBOL_DIR"/js/
cp "$UBO_DIR"/src/js/dom.js "$UBOL_DIR"/js/
cp "$UBO_DIR"/src/js/fa-icons.js "$UBOL_DIR"/js/
cp "$UBO_DIR"/src/js/i18n.js "$UBOL_DIR"/js/
cp "$UBO_DIR"/src/js/jsonpath.js "$UBOL_DIR"/js/
cp "$UBO_DIR"/src/js/redirect-resources.js "$UBOL_DIR"/js/
cp "$UBO_DIR"/src/js/static-filtering-parser.js "$UBOL_DIR"/js/
cp "$UBO_DIR"/src/js/urlskip.js "$UBOL_DIR"/js/
cp "$UBO_DIR"/src/lib/punycode.js "$UBOL_DIR"/js/

cp -R "$UBO_DIR/src/img/flags-of-the-world" "$UBOL_DIR"/img

cp LICENSE.txt "$UBOL_DIR"/

echo "*** uBOLite.mv3: Copying mv3-specific files"
cp platform/mv3/"$MANIFEST_DIR"/manifest.json "$UBOL_DIR"/
cp platform/mv3/extension/*.html "$UBOL_DIR"/
cp platform/mv3/extension/*.json "$UBOL_DIR"/
cp platform/mv3/extension/css/* "$UBOL_DIR"/css/
cp -R platform/mv3/extension/js/* "$UBOL_DIR"/js/
cp platform/mv3/"$PLATFORM"/ext-compat.js "$UBOL_DIR"/js/ 2>/dev/null || :
cp platform/mv3/"$PLATFORM"/css-api.js "$UBOL_DIR"/js/scripting/ 2>/dev/null || :
cp platform/mv3/"$PLATFORM"/css-user.js "$UBOL_DIR"/js/scripting/ 2>/dev/null || :
cp platform/mv3/extension/img/* "$UBOL_DIR"/img/
cp platform/mv3/"$PLATFORM"/img/* "$UBOL_DIR"/img/ 2>/dev/null || :
cp -R platform/mv3/extension/_locales "$UBOL_DIR"/
cp platform/mv3/README.md "$UBOL_DIR/"

# Libraries
mkdir -p "$UBOL_DIR"/lib/codemirror
cp platform/mv3/extension/lib/codemirror/* \
    "$UBOL_DIR"/lib/codemirror/ 2>/dev/null || :
cp platform/mv3/extension/lib/codemirror/codemirror-ubol/dist/cm6.bundle.ubol.min.js \
    "$UBOL_DIR"/lib/codemirror/
cp platform/mv3/extension/lib/codemirror/codemirror.LICENSE \
    "$UBOL_DIR"/lib/codemirror/
cp platform/mv3/extension/lib/codemirror/codemirror-ubol/LICENSE \
    "$UBOL_DIR"/lib/codemirror/codemirror-quickstart.LICENSE
mkdir -p "$UBOL_DIR"/lib/csstree
cp "$UBO_DIR"/src/lib/csstree/* "$UBOL_DIR"/lib/csstree/

echo "*** uBOLite.mv3: Generating rulesets"
UBOL_BUILD_DIR=$(mktemp -d)
mkdir -p "$UBOL_BUILD_DIR"
./tools/make-nodejs.sh "$UBOL_BUILD_DIR"
cp platform/mv3/*.json "$UBOL_BUILD_DIR"/
cp platform/mv3/*.js "$UBOL_BUILD_DIR"/
cp platform/mv3/*.mjs "$UBOL_BUILD_DIR"/
cp platform/mv3/extension/js/utils.js "$UBOL_BUILD_DIR"/js/
cp -R "$UBO_DIR"/src/js/resources "$UBOL_BUILD_DIR"/js/
cp -R platform/mv3/scriptlets "$UBOL_BUILD_DIR"/
mkdir -p "$UBOL_BUILD_DIR"/web_accessible_resources
cp "$UBO_DIR"/src/web_accessible_resources/* "$UBOL_BUILD_DIR"/web_accessible_resources/
cp -R platform/mv3/"$PLATFORM" "$UBOL_BUILD_DIR"/

cd "$UBOL_BUILD_DIR"
node --no-warnings make-rulesets.js output="$UBOL_DIR" platform="$PLATFORM"
if [ -n "$BEFORE" ]; then
    echo "*** uBOLite.mv3: salvaging rule ids to minimize diff size"
    echo "    before=$BEFORE/$PLATFORM"
    echo "    after=$UBOL_DIR"
    node salvage-ruleids.mjs before="$BEFORE"/"$PLATFORM" after="$UBOL_DIR"
fi
cd - > /dev/null
rm -rf "$UBOL_BUILD_DIR"

echo "*** uBOLite.$PLATFORM: extension ready"
echo "Extension location: $UBOL_DIR/"

# Local build
tmp_manifest=$(mktemp)
chmod '=rw' "$tmp_manifest"
if [ -z "$TAGNAME" ]; then
    TAGNAME="$(jq -r .version "$UBOL_DIR"/manifest.json)"
    # Enable DNR rule debugging
    jq '.permissions += ["declarativeNetRequestFeedback"]' \
        "$UBOL_DIR/manifest.json" > "$tmp_manifest" \
        && mv "$tmp_manifest" "$UBOL_DIR/manifest.json"
    # Use a different extension id than the official one
    if [ "$PLATFORM" = "firefox" ]; then
        jq '.browser_specific_settings.gecko.id = "uBOLite.dev@raymondhill.net"' "$UBOL_DIR/manifest.json"  > "$tmp_manifest" \
            && mv "$tmp_manifest" "$UBOL_DIR/manifest.json"
    fi
else
    jq --arg version "${TAGNAME}" '.version = $version' "$UBOL_DIR/manifest.json"  > "$tmp_manifest" \
        && mv "$tmp_manifest" "$UBOL_DIR/manifest.json"
fi

# Platform-specific steps
if [ "$PLATFORM" = "edge" ]; then
    # For Edge, declared rulesets must be at package root
    echo "*** uBOLite.edge: Modify reference implementation for Edge compatibility"
    mv "$UBOL_DIR"/rulesets/main/* "$UBOL_DIR/"
    rmdir "$UBOL_DIR/rulesets/main"
    node platform/mv3/edge/patch-extension.js packageDir="$UBOL_DIR"
elif [ "$PLATFORM" = "safari" ]; then
    # For Safari, we must fix the package for compliance
    node platform/mv3/safari/patch-extension.js packageDir="$UBOL_DIR"
fi

if [ "$FULL" = "yes" ]; then
    EXTENSION="zip"
    if [ "$PLATFORM" = "firefox" ]; then
        EXTENSION="xpi"
    fi
    echo "*** uBOLite.mv3: Creating publishable package..."
    UBOL_PACKAGE_NAME="uBOLite_$TAGNAME.$PLATFORM.$EXTENSION"
    UBOL_PACKAGE_DIR=$(mktemp -d)
    mkdir -p "$UBOL_PACKAGE_DIR"
    cp -R "$UBOL_DIR"/* "$UBOL_PACKAGE_DIR"/
    cd "$UBOL_PACKAGE_DIR" > /dev/null
    rm -f ./log.txt
    zip "$UBOL_PACKAGE_NAME" -qr ./*
    cd - > /dev/null
    cp "$UBOL_PACKAGE_DIR"/"$UBOL_PACKAGE_NAME" dist/build/
    rm -rf "$UBOL_PACKAGE_DIR"
    echo "Package location: $(pwd)/dist/build/$UBOL_PACKAGE_NAME"
fi
