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

manifest_out = {}
manifest_out_file = os.path.join(build_dir, 'manifest.json')
with open(manifest_out_file) as f:
    manifest_out = json.load(f)

manifest_out['version'] = version

# Development build? If so, modify name accordingly.
match = re.search('^\d+\.\d+\.\d+\.\d+$', version)
if match:
    manifest_out['name'] += ' development build'
    manifest_out['short_name'] += ' dev build'
    manifest_out['browser_action']['default_title'] += ' dev build'

with open(manifest_out_file, 'w') as f:
    json.dump(manifest_out, f, indent=2, separators=(',', ': '), sort_keys=True)
    f.write('\n')
