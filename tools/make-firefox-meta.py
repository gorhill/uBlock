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

firefox_manifest = {}
firefox_manifest_file = os.path.join(build_dir, 'manifest.json')
with open(firefox_manifest_file) as f2:
    firefox_manifest = json.load(f2)

match = re.search('^(\d+\.\d+\.\d+)(\.\d+)$', version)
if not match:
    # https://bugzilla.mozilla.org/show_bug.cgi?id=1459007
    # By design Firefox opens the sidebar with new installation of
    # uBO when sidebar_action is present in the manifest.
    # Remove sidebarAction support for stable release of uBO.
    del firefox_manifest['sidebar_action']

firefox_manifest['version'] = version

with open(firefox_manifest_file, 'w') as f2:
    json.dump(firefox_manifest, f2, indent=2, separators=(',', ': '), sort_keys=True)
    f2.write('\n')
