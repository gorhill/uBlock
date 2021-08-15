.PHONY: all clean test lint chromium firefox npm

sources := $(wildcard src/* src/*/* src/*/*/* src/*/*/*/*)
platform := $(wildcard platform/* platform/*/*)
assets := $(wildcard submodules/uAssets/* \
                     submodules/uAssets/*/* \
                     submodules/uAssets/*/*/* \
                     submodules/uAssets/*/*/*/*)

all: chromium firefox npm

dist/build/uBlock0.chromium: tools/make-chromium.sh $(sources) $(platform) $(assets)
	tools/make-chromium.sh

# Build the extension for Chromium.
chromium: dist/build/uBlock0.chromium

dist/build/uBlock0.firefox: tools/make-firefox.sh $(sources) $(platform) $(assets)
	tools/make-firefox.sh all

# Build the extension for Firefox.
firefox: dist/build/uBlock0.firefox

dist/build/uBlock0.npm: tools/make-nodejs.sh $(sources) $(platform) $(assets)
	tools/make-npm.sh

# Build the Node.js package.
npm: dist/build/uBlock0.npm

lint: npm
	cd dist/build/uBlock0.npm && npm install && npm run lint

test: npm
	cd dist/build/uBlock0.npm && npm install && npm run test

dist/build/uBlock0.dig: tools/make-nodejs.sh $(sources) $(platform) $(assets)
	tools/make-dig.sh

dig: dist/build/uBlock0.dig
	cd dist/build/uBlock0.dig && npm install && npm run test

# Update submodules.
update-submodules:
	tools/update-submodules.sh

clean:
	rm -rf dist/build
