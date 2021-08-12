.PHONY: all clean test lint chromium firefox nodejs

sources := $(wildcard src/* src/*/* src/*/*/* src/*/*/*/*)
platform := $(wildcard platform/* platform/*/*)
assets := $(wildcard submodules/uAssets/* \
                     submodules/uAssets/*/* \
                     submodules/uAssets/*/*/* \
                     submodules/uAssets/*/*/*/*)

all: chromium firefox nodejs

dist/build/uBlock0.chromium: tools/make-chromium.sh $(sources) $(platform) $(assets)
	tools/make-chromium.sh

# Build the extension for Chromium.
chromium: dist/build/uBlock0.chromium

dist/build/uBlock0.firefox: tools/make-firefox.sh $(sources) $(platform) $(assets)
	tools/make-firefox.sh all

# Build the extension for Firefox.
firefox: dist/build/uBlock0.firefox

dist/build/uBlock0.nodejs: tools/make-nodejs.sh $(sources) $(platform) $(assets)
	tools/make-nodejs.sh

# Build the Node.js package.
nodejs: dist/build/uBlock0.nodejs

lint: nodejs
	cd dist/build/uBlock0.nodejs && npm install && npm run lint

test: nodejs
	cd dist/build/uBlock0.nodejs && npm install && npm run test

# Update submodules.
update-submodules:
	tools/update-submodules.sh

clean:
	rm -rf dist/build
