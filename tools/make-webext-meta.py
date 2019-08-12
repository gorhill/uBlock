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
with open(webext_manifest_file, encoding='utf-8') as f2:
    webext_manifest = json.load(f2)

webext_manifest['version'] = version

match = re.search('^\d+\.\d+\.\d+\.\d+$', version)
if match:
    webext_manifest['name'] += ' development build'
    webext_manifest['short_name'] += ' dev build'
    webext_manifest['browser_action']['default_title'] += ' dev build'
else:
    # https://bugzilla.mozilla.org/show_bug.cgi?id=1459007
    # By design Firefox opens the sidebar with new installation of
    # uBO when sidebar_action is present in the manifest.
    # Remove sidebarAction support for stable release of uBO.
    del webext_manifest['sidebar_action']

with open(webext_manifest_file, mode='w', encoding='utf-8') as f2:
    json.dump(webext_manifest, f2, indent=2, separators=(',', ': '), sort_keys=True)
    f2.write('\n')
