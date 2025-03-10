# https://stackoverflow.com/a/6273809
run_options := $(filter-out $@,$(MAKECMDGOALS))

.PHONY: all clean cleanassets test lint chromium opera firefox npm dig \
	mv3-chromium mv3-firefox mv3-edge \
	compare maxcost medcost mincost modifiers record wasm

sources := $(wildcard assets/* assets/*/* dist/version src/* src/*/* src/*/*/* src/*/*/*/*)
platform := $(wildcard platform/* platform/*/* platform/*/*/* platform/*/*/*/* platform/*/*/*/*/*)
assets := dist/build/uAssets
mv3-data := $(wildcard dist/build/mv3-data/*)

all: chromium firefox npm

dist/build/uBlock0.chromium: tools/make-chromium.sh $(sources) $(platform) $(assets)
	tools/make-chromium.sh

# Build the extension for Chromium.
chromium: dist/build/uBlock0.chromium

dist/build/uBlock0.opera: tools/make-opera.sh $(sources) $(platform) $(assets)
	tools/make-opera.sh

# Build the extension for Opera.
opera: dist/build/uBlock0.opera

dist/build/uBlock0.firefox: tools/make-firefox.sh $(sources) $(platform) $(assets)
	tools/make-firefox.sh all

# Build the extension for Firefox.
firefox: dist/build/uBlock0.firefox

dist/build/uBlock0.npm: tools/make-nodejs.sh $(sources) $(platform) $(assets)
	tools/make-npm.sh

npm: dist/build/uBlock0.npm

# Dev tools
node_modules:
	npm install

init: node_modules

lint: init
	npm run lint

test: npm
	cd dist/build/uBlock0.npm && npm run test

test-full-battery: npm
	cd dist/build/uBlock0.npm && npm run test-full-battery

check-leaks: npm
	cd dist/build/uBlock0.npm && npm run check-leaks

dist/build/uBlock0.dig: tools/make-nodejs.sh $(sources) $(platform) $(assets)
	tools/make-dig.sh

dig: dist/build/uBlock0.dig
	cd dist/build/uBlock0.dig && npm install

dig-snfe: dig
	cd dist/build/uBlock0.dig && npm run snfe $(run_options)

dist/build/mv3-data:
	mkdir -p dist/build/mv3-data

dist/build/uBOLite.chromium: tools/make-mv3.sh $(sources) $(platform) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh chromium

mv3-chromium: dist/build/uBOLite.chromium

dist/build/uBOLite.firefox: tools/make-mv3.sh $(sources) $(platform) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh firefox

mv3-firefox: dist/build/uBOLite.firefox

dist/build/uBOLite.edge: tools/make-mv3.sh tools/make-edge.mjs $(sources) $(platform) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh edge

mv3-edge: dist/build/uBOLite.edge

dist/build/uAssets:
	tools/pull-assets.sh

clean:
	rm -rf dist/build tmp/node_modules node_modules

cleanassets:
	rm -rf dist/build/mv3-data dist/build/uAssets

# Not real targets, just convenient for auto-completion at shell prompt
compare:
	@echo
maxcost:
	@echo
medcost:
	@echo
mincost:
	@echo
modifiers:
	@echo
record:
	@echo
wasm:
	@echo
