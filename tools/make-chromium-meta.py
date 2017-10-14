#!/usr/bin/env python3

import os
import json
import re
import sys

if len(sys.argv) == 1 or not sys.argv[1]:
    raise SystemExit('Build dir missing.')

proj_dir = os.path.join(os.path.split(os.path.abspath(__file__))[0], '..')

manifest_in = {}
manifest_in_file = os.path.join(proj_dir, 'platform', 'chromium', 'manifest.json')
with open(manifest_in_file) as f1:
    manifest_in = json.load(f1)

# Development build? If so, modify name accordingly.
match = re.search('^\d+\.\d+\.\d+\.\d+$', manifest_in['version'])
if match:
    build_dir = os.path.abspath(sys.argv[1])
    dev_build = ' dev build'
    manifest_out = {}
    manifest_out_file = os.path.join(build_dir, 'manifest.json')
    with open(manifest_out_file) as f2:
        manifest_out = json.load(f2)
    manifest_out['name'] += dev_build
    manifest_out['short_name'] += dev_build
    manifest_out['browser_action']['default_title'] += dev_build
    with open(manifest_out_file, 'w') as f2:
        json.dump(manifest_out, f2, indent=2, separators=(',', ': '), sort_keys=True)
        f2.write('\n')
