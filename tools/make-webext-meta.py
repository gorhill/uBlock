#!/usr/bin/env python3

import os
import json
import re
import sys

if len(sys.argv) == 1 or not sys.argv[1]:
    raise SystemExit('Build dir missing.')

proj_dir = os.path.join(os.path.split(os.path.abspath(__file__))[0], '..')
build_dir = os.path.abspath(sys.argv[1])

version = ''
with open(os.path.join(proj_dir, 'dist', 'version')) as f:
    version = f.read().strip()

webext_manifest = {}
webext_manifest_file = os.path.join(build_dir, 'manifest.json')
with open(webext_manifest_file) as f2:
    webext_manifest = json.load(f2)

match = re.search('^(\d+\.\d+\.\d+)(\.\d+)$', version)
if match:
    buildtype = int(match.group(2)[1:])
    if buildtype < 100:
        builttype = 'b' + str(buildtype)
    else:
        builttype = 'rc' + str(buildtype - 100)
    webext_manifest['version'] = match.group(1) + builttype
else:
    webext_manifest['version'] = version

with open(webext_manifest_file, 'w') as f2:
    json.dump(webext_manifest, f2, indent=2, separators=(',', ': '), sort_keys=True)
    f2.write('\n')
