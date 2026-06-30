#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e
shopt -s extglob

echo "*** AdNauseamLite.mv3: Creating extension"

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

ADNL_DIR="dist/build/ADNLite.$PLATFORM"

if [ "$PLATFORM" = "edge" ]; then
    MANIFEST_DIR="chromium"
else
    MANIFEST_DIR="$PLATFORM"
fi

rm -rf $ADNL_DIR

mkdir -p $ADNL_DIR
cd $ADNL_DIR
ADNL_DIR=$(pwd)
cd - > /dev/null

mkdir -p "$ADNL_DIR"/css/fonts
mkdir -p "$ADNL_DIR"/js/offscreen
mkdir -p "$ADNL_DIR"/img
mkdir -p "$ADNL_DIR"/lib

if [ -n "$ADN_VERSION" ]; then
    ADN_REPO="https://github.com/dhowe/AdNauseam.git"
    ADN_DIR=$(mktemp -d)
    echo "*** AdNauseamLite.mv3: Fetching uBO $ADN_VERSION from $ADN_REPO into $ADN_DIR"
    cd "$ADN_DIR"
    git init -q
    git remote add origin "https://github.com/dhowe/AdNauseam.git"
    git fetch --depth 1 origin "$ADN_VERSION"
    git checkout -q FETCH_HEAD
    cd - > /dev/null
else
    ADN_DIR=.
fi

echo "*** AdnauseamLite.mv3: Copying common files"
cp -R "$ADN_DIR"/src/css/fonts/Inter "$ADNL_DIR"/css/fonts/
cp -R "$ADN_DIR"/src/css/fonts/Noto_Sans "$ADNL_DIR"/css/fonts/
cp -R "$ADN_DIR"/src/css/fonts/Roboto_Flex "$ADNL_DIR"/css/fonts/
cp "$ADN_DIR"/src/css/fonts/stylesheet.css "$ADNL_DIR"/css/fonts/
cp "$ADN_DIR"/src/css/fonts/bebasneue_*.woff2 "$ADNL_DIR"/css/fonts/
cp "$ADN_DIR"/src/css/fonts/bebasneue_*.woff "$ADNL_DIR"/css/fonts/
cp "$ADN_DIR"/src/css/fonts/bebasneue_*.ttf "$ADNL_DIR"/css/fonts/
cp "$ADN_DIR"/src/css/fonts/fontawesome-webfont.ttf "$ADNL_DIR"/css/fonts/
cp "$ADN_DIR"/src/css/themes/default.css "$ADNL_DIR"/css/
cp "$ADN_DIR"/src/css/common.css "$ADNL_DIR"/css/
cp "$ADN_DIR"/src/css/dashboard-common.css "$ADNL_DIR"/css/
cp "$ADN_DIR"/src/css/fa-icons.css "$ADNL_DIR"/css/

cp "$ADN_DIR"/src/js/arglist-parser.js "$ADNL_DIR"/js/
cp "$ADN_DIR"/src/js/dom.js "$ADNL_DIR"/js/
cp "$ADN_DIR"/src/js/fa-icons.js "$ADNL_DIR"/js/
cp "$ADN_DIR"/src/js/i18n.js "$ADNL_DIR"/js/
cp "$ADN_DIR"/src/js/jsonpath.js "$ADNL_DIR"/js/
cp "$ADN_DIR"/src/js/redirect-resources.js "$ADNL_DIR"/js/
cp "$ADN_DIR"/src/js/regex-analyzer.js "$ADNL_DIR"/js/offscreen/
cp -R "$ADN_DIR"/src/js/resources "$ADNL_DIR"/js/
cp "$ADN_DIR"/src/js/static-filtering-parser.js "$ADNL_DIR"/js/
cp "$ADN_DIR"/src/js/urlskip.js "$ADNL_DIR"/js/
cp "$ADN_DIR"/src/lib/punycode.js "$ADNL_DIR"/js/
cp -R "$ADN_DIR"/src/lib/regexanalyzer "$ADNL_DIR"/lib/

cp -R "$ADN_DIR/src/img/flags-of-the-world" "$ADNL_DIR"/img

cp LICENSE.txt "$ADNL_DIR"/

echo "*** AdNauseamLite.mv3: Copying mv3-specific files"

cp platform/mv3/"$MANIFEST_DIR"/manifest.json "$ADNL_DIR"/
cp platform/mv3/extension/*.html "$ADNL_DIR"/
cp platform/mv3/extension/*.json "$ADNL_DIR"/
cp platform/mv3/extension/css/* "$ADNL_DIR"/css/
cp -R platform/mv3/extension/js/* "$ADNL_DIR"/js/
cp platform/mv3/"$PLATFORM"/ext-compat.js "$ADNL_DIR"/js/ 2>/dev/null || :
cp platform/mv3/"$PLATFORM"/css-api.js "$ADNL_DIR"/js/scripting/ 2>/dev/null || :
cp platform/mv3/"$PLATFORM"/css-user.js "$ADNL_DIR"/js/scripting/ 2>/dev/null || :
cp platform/mv3/extension/img/* "$ADNL_DIR"/img/
cp platform/mv3/"$PLATFORM"/img/* "$ADNL_DIR"/img/ 2>/dev/null || :
cp -R platform/mv3/extension/_locales "$ADNL_DIR"/
cp platform/mv3/README.md "$ADNL_DIR/"

# Merge MV2 locale messages (messages.json + adnauseam.json) into MV3 locales
# Priority: MV3 messages.json > MV2 adnauseam.json > MV2 messages.json
echo "*** AdNauseamLite.mv3: Merging MV2 locales into MV3"
for mv3_locale_dir in "$ADNL_DIR"/_locales/*/; do
    locale=$(basename "$mv3_locale_dir")
    mv2_messages="$ADN_DIR/src/_locales/$locale/messages.json"
    mv2_adnauseam="$ADN_DIR/src/_locales/$locale/adnauseam.json"
    mv3_messages="$mv3_locale_dir/messages.json"
    if [ -f "$mv3_messages" ]; then
        tmp_merged=$(mktemp)
        if [ -f "$mv2_messages" ] && [ -f "$mv2_adnauseam" ]; then
            jq -s '.[0] * .[1] * .[2]' "$mv2_messages" "$mv2_adnauseam" "$mv3_messages" > "$tmp_merged" \
                && mv "$tmp_merged" "$mv3_messages"
        elif [ -f "$mv2_messages" ]; then
            jq -s '.[0] * .[1]' "$mv2_messages" "$mv3_messages" > "$tmp_merged" \
                && mv "$tmp_merged" "$mv3_messages"
        elif [ -f "$mv2_adnauseam" ]; then
            jq -s '.[0] * .[1]' "$mv2_adnauseam" "$mv3_messages" > "$tmp_merged" \
                && mv "$tmp_merged" "$mv3_messages"
        else
            rm -f "$tmp_merged"
        fi
    fi
done

# Libraries
mkdir -p "$ADNL_DIR"/lib/codemirror
cp platform/mv3/extension/lib/codemirror/* \
    "$ADNL_DIR"/lib/codemirror/ 2>/dev/null || :
cp platform/mv3/extension/lib/codemirror/codemirror-ubol/dist/cm6.bundle.ubol.min.js \
    "$ADNL_DIR"/lib/codemirror/
cp platform/mv3/extension/lib/codemirror/codemirror.LICENSE \
    "$ADNL_DIR"/lib/codemirror/
cp platform/mv3/extension/lib/codemirror/codemirror-ubol/LICENSE \
    "$ADNL_DIR"/lib/codemirror/codemirror-quickstart.LICENSE
mkdir -p "$ADNL_DIR"/lib/csstree
cp "$ADN_DIR"/src/lib/csstree/* "$ADNL_DIR"/lib/csstree/
cp platform/mv3/extension/lib/s14e-serializer/s14e-serializer.js \
    "$ADNL_DIR"/lib/

# AdNauseam libraries
cp platform/mv3/extension/lib/yamd5.js "$ADNL_DIR"/lib/

# AdNauseam menu: copy source CSS & images (overrides MV3 placeholder)
echo "*** AdNauseamLite.mv3: Copying menu dependencies from src"
cp "$ADN_DIR"/src/css/menu.css "$ADNL_DIR"/css/
cp "$ADN_DIR"/src/img/active@2x.png "$ADNL_DIR"/img/ 2>/dev/null || :
cp "$ADN_DIR"/src/img/ublock.svg "$ADNL_DIR"/img/ 2>/dev/null || :
cp "$ADN_DIR"/src/img/gray_grid.png "$ADNL_DIR"/img/ 2>/dev/null || :

# AdNauseam vault: copy source files at build time (avoids duplication)
echo "*** AdNauseamLite.mv3: Copying vault dependencies from src"
cp "$ADN_DIR"/src/css/vault.css "$ADNL_DIR"/css/
cp "$ADN_DIR"/src/css/fonts/stylesheet.css "$ADNL_DIR"/css/fonts/
cp "$ADN_DIR"/src/css/fonts/bebasneue_* "$ADNL_DIR"/css/fonts/
cp -R "$ADN_DIR"/src/css/fonts/Noto_Sans "$ADNL_DIR"/css/fonts/
cp -R "$ADN_DIR"/src/css/fonts/Roboto_Flex "$ADNL_DIR"/css/fonts/
cp "$ADN_DIR"/src/img/preloader.gif "$ADNL_DIR"/img/ 2>/dev/null || :
cp "$ADN_DIR"/src/img/alert.png "$ADNL_DIR"/img/ 2>/dev/null || :
cp "$ADN_DIR"/src/img/black.png "$ADNL_DIR"/img/ 2>/dev/null || :
cp "$ADN_DIR"/src/img/statistics-icon.svg "$ADNL_DIR"/img/ 2>/dev/null || :
cp "$ADN_DIR"/src/img/timeline-handle.svg "$ADNL_DIR"/img/ 2>/dev/null || :
cp "$ADN_DIR"/src/js/adn/vault.js "$ADNL_DIR"/js/adn/
cp "$ADN_DIR"/src/js/adn/uDom.js "$ADNL_DIR"/js/adn/
cp "$ADN_DIR"/src/js/adn/notifications.js "$ADNL_DIR"/js/adn/
cp "$ADN_DIR"/src/js/adn/adn-utils.js "$ADNL_DIR"/js/adn/vault-adn-utils.js
cp "$ADN_DIR"/src/lib/jquery.js "$ADNL_DIR"/lib/
cp "$ADN_DIR"/src/lib/jquery.mousewheel.min.js "$ADNL_DIR"/lib/
cp "$ADN_DIR"/src/lib/packery.js "$ADNL_DIR"/lib/
cp "$ADN_DIR"/src/lib/d3.min.js "$ADNL_DIR"/lib/
# Overwrite MV3 module yamd5 with src global version (vault loads it as <script>)
cp "$ADN_DIR"/src/lib/yamd5.js "$ADNL_DIR"/lib/

# Patch imports in copied vault files for MV3 compatibility:
#   - vault.js and notifications.js: adn-utils.js → vault-adn-utils.js
#     (so the full src version is used instead of the MV3-slim version)
sed -i '' "s|from './adn-utils.js'|from './vault-adn-utils.js'|" "$ADNL_DIR"/js/adn/vault.js
sed -i '' "s|from \"./adn-utils.js\"|from \"./vault-adn-utils.js\"|" "$ADNL_DIR"/js/adn/notifications.js

echo "*** AdnauseamLite.mv3: Generating rulesets"
UBOL_BUILD_DIR=$(mktemp -d)
mkdir -p "$UBOL_BUILD_DIR"
./tools/make-nodejs.sh "$UBOL_BUILD_DIR"
cp platform/mv3/*.json "$UBOL_BUILD_DIR"/
cp platform/mv3/*.js "$UBOL_BUILD_DIR"/
cp platform/mv3/*.mjs "$UBOL_BUILD_DIR"/
cp platform/mv3/extension/js/utils.js "$UBOL_BUILD_DIR"/js/
cp -R "$ADN_DIR"/src/lib/regexanalyzer "$UBOL_BUILD_DIR"/
cp -R "$ADN_DIR"/src/js/resources "$UBOL_BUILD_DIR"/js/
cp -R platform/mv3/scriptlets "$UBOL_BUILD_DIR"/
cp -R platform/mv3/extension/js/offscreen "$UBOL_BUILD_DIR"/js/
cp "$ADN_DIR"/src/js/regex-analyzer.js "$UBOL_BUILD_DIR"/js/offscreen/
mkdir -p "$UBOL_BUILD_DIR"/web_accessible_resources
cp "$ADN_DIR"/src/web_accessible_resources/* "$UBOL_BUILD_DIR"/web_accessible_resources/
cp -R platform/mv3/"$PLATFORM" "$UBOL_BUILD_DIR"/

cd "$UBOL_BUILD_DIR"
node --no-warnings make-rulesets.js output="$ADNL_DIR" platform="$PLATFORM"
if [ -n "$BEFORE" ]; then
    echo "*** AdnauseamLite.mv3: salvaging rule ids to minimize diff size"
    echo "    before=$BEFORE/$PLATFORM"
    echo "    after=$ADNL_DIR"
    node salvage-ruleids.mjs before="$BEFORE"/"$PLATFORM" after="$ADNL_DIR"
fi
cd - > /dev/null
rm -rf "$UBOL_BUILD_DIR"

echo "*** AdnauseamLite.$PLATFORM: extension ready"
echo "Extension location: $ADNL_DIR/"

# Local build
tmp_manifest=$(mktemp)
chmod '=rw' "$tmp_manifest"
if [ -z "$TAGNAME" ]; then
    TAGNAME="$(jq -r .version "$ADNL_DIR"/manifest.json)"
    # Enable DNR rule debugging
    jq '.permissions += ["declarativeNetRequestFeedback"]' \
        "$ADNL_DIR/manifest.json" > "$tmp_manifest" \
        && mv "$tmp_manifest" "$ADNL_DIR/manifest.json"
    # Use a different extension id than the official one
    if [ "$PLATFORM" = "firefox" ]; then
        jq '.browser_specific_settings.gecko.id = "AdnauseamLite.dev@raymondhill.net"' "$ADNL_DIR/manifest.json"  > "$tmp_manifest" \
            && mv "$tmp_manifest" "$ADNL_DIR/manifest.json"
    fi
else
    jq --arg version "${TAGNAME}" '.version = $version' "$ADNL_DIR/manifest.json"  > "$tmp_manifest" \
        && mv "$tmp_manifest" "$ADNL_DIR/manifest.json"
    rm -rf "$ADNL_DIR/rulesets/debug"
fi

# Platform-specific steps
if [ "$PLATFORM" = "edge" ]; then
    # For Edge, declared rulesets must be at package root
    echo "*** AdnauseamLite.edge: Modify reference implementation for Edge compatibility"
    mv "$ADNL_DIR"/rulesets/main/* "$ADNL_DIR/"
    rmdir "$ADNL_DIR/rulesets/main"
    node platform/mv3/edge/patch-extension.js packageDir="$ADNL_DIR"
elif [ "$PLATFORM" = "safari" ]; then
    # For Safari, we must fix the package for compliance
    node platform/mv3/safari/patch-extension.js packageDir="$ADNL_DIR"
fi

if [ "$FULL" = "yes" ]; then
    EXTENSION="zip"
    if [ "$PLATFORM" = "firefox" ]; then
        EXTENSION="xpi"
    fi
    echo "*** AdnauseamLite.mv3: Creating publishable package..."
    UBOL_PACKAGE_NAME="AdnauseamLite_$TAGNAME.$PLATFORM.$EXTENSION"
    UBOL_PACKAGE_DIR=$(mktemp -d)
    mkdir -p "$UBOL_PACKAGE_DIR"
    cp -R "$ADNL_DIR"/* "$UBOL_PACKAGE_DIR"/
    cd "$UBOL_PACKAGE_DIR" > /dev/null
    rm -f ./log.txt
    zip "$UBOL_PACKAGE_NAME" -qr ./*
    cd - > /dev/null
    cp "$UBOL_PACKAGE_DIR"/"$UBOL_PACKAGE_NAME" dist/build/
    rm -rf "$UBOL_PACKAGE_DIR"
    echo "Package location: $(pwd)/dist/build/$UBOL_PACKAGE_NAME"
fi
