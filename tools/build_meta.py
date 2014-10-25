#!/usr/bin/env python3

import os
import re
import json
from time import strftime
from datetime import datetime
from shutil import rmtree as rmt
from collections import OrderedDict
from xml.sax.saxutils import escape

osp = os.path
pj = osp.join

os.chdir('..')


def rmtree(path):
    if osp.exists(path):
        rmt(path)


def mkdirs(path):
    try:
        os.makedirs(path)
    finally:
        return osp.exists(path)


meta_dir = pj('meta')
src_dir = pj('src')

with open(pj(meta_dir, 'config.json'), encoding='utf-8') as f:
    config = json.load(f)

vendors = config['vendors']
del config['vendors']

src_dir = pj('src')
source_locale_dir = pj('src', '_locales')
target_locale_dir = pj('src', 'locale')
descriptions = OrderedDict({})

tmp = datetime.now() - datetime(year=datetime.today().year, month=1, day=1)
config['build_number'] = strftime('%y' + str(int(tmp.total_seconds() * 65535 / 31536000)).zfill(5))

rmtree(target_locale_dir)


with open(pj(src_dir, 'js', 'vapi-appinfo.js'), 'r+t', encoding='utf-8', newline='\n') as f:
    tmp = f.read()
    f.seek(0)

    f.write(re.sub(
        r'/\*\*/([^:]+:).+',
        lambda m: '/**/' + m.group(1) + " '" + config[m.group(1)[:-1]] + "',",
        tmp
    ))


for alpha2 in os.listdir(source_locale_dir):
    with open(pj(source_locale_dir, alpha2, 'messages.json'), encoding='utf-8') as f:
        string_data = json.load(f, object_pairs_hook=OrderedDict)

    alpha2 = alpha2.replace('_', '-')

    mkdirs(pj(target_locale_dir, alpha2))

    with open(pj(target_locale_dir, alpha2, 'messages.properties'), 'wt', encoding='utf-8', newline='\n') as f:
        descriptions[alpha2] = {}

        for string_name in string_data:
            if string_name == 'extShortDesc':
                descriptions[alpha2] = string_data[string_name]['message']

            f.write(string_name)
            f.write('=')
            f.write(string_data[string_name]['message'].replace('\n', r'\n'))
            f.write('\n')


with open(pj(src_dir, 'locales.json'), 'wt', encoding='utf-8', newline='\n') as f:
    tmp = {
        '_': config['def_lang']
    }

    for alpha2 in descriptions:
        tmp[alpha2] = 1

    json.dump(tmp, f, sort_keys=True, ensure_ascii=False)


with open(pj(src_dir, vendors['crx']['manifest']), 'wt', encoding='utf-8', newline='\n') as f:
    with open(pj(meta_dir, 'crx', vendors['crx']['manifest']), 'r') as cf:
        cf_content = cf.read()

    f.write(
        re.sub(r"\{(?=\W)|(?<=\W)\}", r'\g<0>\g<0>', cf_content).format(**config)
    )


with open(pj(src_dir, vendors['safariextz']['manifest']), 'wt', encoding='utf-8', newline='\n') as f:
    config['app_id'] = vendors['safariextz']['app_id']
    config['description'] = descriptions[config['def_lang']]

    with open(pj(meta_dir, 'safariextz', vendors['safariextz']['manifest']), 'r') as cf:
        cf_content = cf.read()

    f.write(cf_content.format(**config))
