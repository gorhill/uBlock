.PHONY: all clean install chromium firefox nodejs install-nodejs-link install-nodejs uninstall-nodejs

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

# Install the Node.js package as a link in the node_modules directory. This is
# convenient for development, but it breaks when the dist/build directory is
# cleaned up.
install-nodejs-link: dist/build/uBlock0.nodejs
	npm install dist/build/uBlock0.nodejs --no-save

dist/build/uBlock0.nodejs.tgz: dist/build/uBlock0.nodejs
	cd dist/build && tar czf uBlock0.nodejs.tgz uBlock0.nodejs

# Install the Node.js package.
install-nodejs: dist/build/uBlock0.nodejs.tgz
	npm install dist/build/uBlock0.nodejs.tgz --no-save

# Uninstall the Node.js package.
uninstall-nodejs:
	npm uninstall '@gorhill/ubo-core' --no-save

# Update submodules.
update-submodules:
	tools/update-submodules.sh

clean:
	rm -rf dist/build
