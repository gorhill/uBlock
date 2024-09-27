# How to build MV3 uBO Lite

Instructions for reviewers.

The following assumes a linux environment.

1. Open Bash console
2. `git clone  https://github.com/gorhill/uBlock.git`
3. `cd uBlock`
4. `make mv3-[platform]`, where `[platform]` is either `chromium` or `firefox`
5. This will fully build uBO Lite, and during the process filter lists will be downloaded from their respective remote servers

Upon completion of the script, the resulting extension package will become present in:

- Chromium: `dist/build/uBOLite.chromium`
-  Firefox: `dist/build/uBOLite.firefox`

The folder `dist/build/mv3-data` will cache data fetched from remote servers, so as to avoid fetching repeatedly from remote servers with repeated build commands. Use `make cleanassets` to remove all locally cached filter lists if you want to build with latest versions of filter lists.

The file `dist/build/mv3-data/log.txt` will contain information about what happened during the build process.

The entry in the `Makefile` which implement the build process is `tools/make-mv3.sh [platform]`.[1] This Bash script copy various files from uBlock Origin branch and MV3-specific branch into a single folder which will be the final extension package.

Notably, `tools/make-mv3.sh [platform]` calls a Nodejs script which purpose is to convert the filter lists into various rulesets to be used in a declarative way. The Nodejs version required is 17.5.0 or above.

All the final rulesets are present in the `dist/build/uBOLite.[platform]/rulesets` in the final extension package.

---

[1] https://github.com/gorhill/uBlock/blob/c4d324362fdb95ff8ef20f0b18f42f0eec955433/tools/make-mv3.sh
[2] https://github.com/gorhill/uBlock/blob/c4d324362fdb95ff8ef20f0b18f42f0eec955433/tools/make-mv3.sh#L103
