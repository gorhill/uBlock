#!/usr/bin/env python3

import os
import json
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

with open(manifest_out_file, 'w') as f2:
    json.dump(manifest_out, f2, indent=2, separators=(',', ': '), sort_keys=True)
    f2.write('\n')
