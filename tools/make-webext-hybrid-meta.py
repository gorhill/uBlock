#!/usr/bin/env python3

import os
import json
import re
import sys
from io import open as uopen
from collections import OrderedDict

if len(sys.argv) == 1 or not sys.argv[1]:
    raise SystemExit('Build dir missing.')

proj_dir = os.path.join(os.path.split(os.path.abspath(__file__))[0], '..')
build_dir = os.path.abspath(sys.argv[1])

# Import data from chromium platform
chromium_manifest = {}
webext_manifest = {}

chromium_manifest_file = os.path.join(proj_dir, 'platform', 'chromium', 'manifest.json')
with open(chromium_manifest_file) as f1:
    chromium_manifest = json.load(f1)

# WebExtension part
webext_manifest_file = os.path.join(build_dir, 'webextension', 'manifest.json')
with open(webext_manifest_file) as f2:
    webext_manifest = json.load(f2)

webext_manifest['version'] = chromium_manifest['version']

with open(webext_manifest_file, 'w') as f2:
    json.dump(webext_manifest, f2, indent=2, separators=(',', ': '), sort_keys=True)
    f2.write('\n')

# Legacy part
descriptions = OrderedDict({})
source_locale_dir = os.path.join(build_dir, 'webextension', '_locales')
for alpha2 in sorted(os.listdir(source_locale_dir)):
    locale_path = os.path.join(source_locale_dir, alpha2, 'messages.json')
    with uopen(locale_path, encoding='utf-8') as f:
        strings = json.load(f, object_pairs_hook=OrderedDict)
    alpha2 = alpha2.replace('_', '-')
    descriptions[alpha2] = strings['extShortDesc']['message']

webext_manifest['author'] = chromium_manifest['author'];
webext_manifest['name'] = chromium_manifest['name'] + '/webext-hybrid'
webext_manifest['homepage'] = 'https://github.com/gorhill/uBlock'
webext_manifest['description'] = descriptions['en']
del descriptions['en']

match = re.search('^(\d+\.\d+\.\d+)(\.\d+)$', chromium_manifest['version'])
if match:
    buildtype = int(match.group(2)[1:])
    if buildtype < 100:
        builttype = 'b' + str(buildtype)
    else:
        builttype = 'rc' + str(buildtype - 100)
    webext_manifest['version'] = match.group(1) + builttype

webext_manifest['localized'] = []
t = '    '
t3 = 3 * t
for alpha2 in descriptions:
    if alpha2 == 'en':
        continue
    webext_manifest['localized'].append(
        '\n' + t*2 + '<em:localized><Description>\n' +
        t3 + '<em:locale>' + alpha2 + '</em:locale>\n' +
        t3 + '<em:name>' + webext_manifest['name'] + '</em:name>\n' +
        t3 + '<em:description>' + descriptions[alpha2] + '</em:description>\n' +
        t3 + '<em:creator>' + webext_manifest['author'] + '</em:creator>\n' +
        # t3 + '<translator>' + ??? + '</translator>\n' +
        t3 + '<em:homepageURL>' + webext_manifest['homepage'] + '</em:homepageURL>\n' +
        t*2 + '</Description></em:localized>'
    )
webext_manifest['localized'] = '\n'.join(webext_manifest['localized'])

install_rdf = os.path.join(build_dir, 'install.rdf')
with uopen(install_rdf, 'r+t', encoding='utf-8', newline='\n') as f:
    install_rdf = f.read()
    f.seek(0)
    f.write(install_rdf.format(**webext_manifest))
    f.truncate()
