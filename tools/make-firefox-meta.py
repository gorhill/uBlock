#!/usr/bin/env python3

import os
import json
import sys
from io import open
from shutil import rmtree
from collections import OrderedDict

if len(sys.argv) == 1 or not sys.argv[1]:
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
descriptions = OrderedDict({})
title_case_strings = ['pickerContextMenuEntry']

for alpha2 in sorted(os.listdir(source_locale_dir)):
    locale_path = pj(source_locale_dir, alpha2, 'messages.json')
    with open(locale_path, encoding='utf-8') as f:
        strings = json.load(f, object_pairs_hook=OrderedDict)

    alpha2 = alpha2.replace('_', '-')
    descriptions[alpha2] = strings['extShortDesc']['message']
    del strings['extShortDesc']

    language_codes.append(alpha2)

    mkdirs(pj(target_locale_dir, alpha2))

    locale_path = pj(target_locale_dir, alpha2, 'messages.properties')
    with open(locale_path, 'wt', encoding='utf-8', newline='\n') as f:
        for string_name in strings:
            string = strings[string_name]['message']

            if alpha2 == 'en' and string_name in title_case_strings:
                string = string.title()

            f.write(string_name)
            f.write(u'=')
            f.write(string.replace('\n', r'\n'))
            f.write(u'\n')

# generate chrome.manifest file
chrome_manifest = pj(build_dir, 'chrome.manifest')

with open(chrome_manifest, 'at', encoding='utf-8', newline='\n') as f:
    f.write(u'\nlocale ublock en ./locale/en/\n')

    for alpha2 in language_codes:
        if alpha2 == 'en':
            continue

        f.write(u'locale ublock ' + alpha2 + ' ./locale/' + alpha2 + '/\n')

rmtree(source_locale_dir)

# update install.rdf
proj_dir = pj(os.path.split(os.path.abspath(__file__))[0], '..')
chromium_manifest = pj(proj_dir, 'platform', 'chromium', 'manifest.json')

with open(chromium_manifest, encoding='utf-8') as m:
    manifest = json.load(m)

manifest['homepage'] = 'https://github.com/chrisaljoudi/uBlock'
manifest['description'] = descriptions['en']
del descriptions['en']
manifest['localized'] = []

t = '    '
t3 = 3 * t

for alpha2 in descriptions:
    if alpha2 == 'en':
        continue

    manifest['localized'].append(
        '\n' + t*2 + '<localized><r:Description>\n' +
        t3 + '<locale>' + alpha2 + '</locale>\n' +
        t3 + '<name>' + manifest['name'] + '</name>\n' +
        t3 + '<description>' + descriptions[alpha2] + '</description>\n' +
        t3 + '<creator>' + manifest['author'] + '</creator>\n' +
        # t3 + '<translator>' + ??? + '</translator>\n' +
        t3 + '<homepageURL>' + manifest['homepage'] + '</homepageURL>\n' +
        t*2 + '</r:Description></localized>'
    )

manifest['localized'] = '\n'.join(manifest['localized'])

install_rdf = pj(build_dir, 'install.rdf')
with open(install_rdf, 'r+t', encoding='utf-8', newline='\n') as f:
    install_rdf = f.read()
    f.seek(0)

    f.write(install_rdf.format(**manifest))
