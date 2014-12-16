#!/usr/bin/env python3

import os
import json
import sys
from shutil import rmtree
from collections import OrderedDict

if not sys.argv[1]:
	raise SystemExit('Build dir missing.')


def mkdirs(path):
    try:
        os.makedirs(path)
    finally:
        return os.path.exists(path)

pj = os.path.join

build_dir = os.path.abspath(sys.argv[1])
source_locale_dir = pj(build_dir, '_locales')
target_locale_dir = pj(build_dir, 'locale')
language_codes = []
description = ''

for alpha2 in os.listdir(source_locale_dir):
    locale_path = pj(source_locale_dir, alpha2, 'messages.json')
    with open(locale_path, encoding='utf-8') as f:
        string_data = json.load(f, object_pairs_hook=OrderedDict)

    if alpha2 == 'en':
        description = string_data['extShortDesc']['message']

    alpha2 = alpha2.replace('_', '-')

    language_codes.append(alpha2)

    mkdirs(pj(target_locale_dir, alpha2))

    locale_path = pj(target_locale_dir, alpha2, 'messages.properties')
    with open(locale_path, 'wt', encoding='utf-8', newline='\n') as f:
        for string_name in string_data:
            f.write(string_name)
            f.write('=')
            f.write(string_data[string_name]['message'].replace('\n', r'\n'))
            f.write('\n')

# generate chrome.manifest file
chrome_manifest = pj(build_dir, 'chrome.manifest')

with open(chrome_manifest, 'at', encoding='utf-8', newline='\n') as f:
    f.write('\n')

    for alpha2 in language_codes:
        f.write('locale ublock ' + alpha2 + ' ./locale/' + alpha2 + '/\n')

rmtree(source_locale_dir)

# update install.rdf
proj_dir = pj(os.path.split(os.path.abspath(__file__))[0], '..')
chromium_manifest = pj(proj_dir, 'platform', 'chromium', 'manifest.json')

with open(chromium_manifest, encoding='utf-8') as m:
    manifest = json.load(m)

manifest['description'] = description

install_rdf = pj(build_dir, 'install.rdf')

with open(install_rdf, 'r+t', encoding='utf-8', newline='\n') as f:
    install_rdf = f.read()
    f.seek(0)

    f.write(install_rdf.format(**manifest))
