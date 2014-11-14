#!/usr/bin/env python3

import os
import re
import json
import glob
import sys
import subprocess
from time import strftime
from datetime import datetime
from shutil import which as iscmd, rmtree as rmt, copytree, copy, move
from collections import OrderedDict
from xml.sax.saxutils import escape

osp = os.path
pj = osp.join

os.chdir(pj(osp.split(osp.abspath(__file__))[0], '..'))


def rmtree(path):
    if osp.exists(path):
        rmt(path)


def mkdirs(path):
    try:
        os.makedirs(path)
    finally:
        return osp.exists(path)


def readfile(path, mode='rt'):
    with open(path, mode) as f:
        return f.read()


src_dir = osp.abspath(pj('src'))
meta_dir = osp.abspath(pj('meta'))
tmp_dir = osp.abspath(pj('tmp'))

with open(pj(meta_dir, 'config.json'), encoding='utf-8') as f:
    config = json.load(f)

vendors = config['vendors']
del config['vendors']

tmp = datetime.now() - datetime(year=datetime.today().year, month=1, day=1)
config['build_number'] = strftime('%y' + str(int(tmp.total_seconds() * 65535 / 31536000)).zfill(5))

descriptions = OrderedDict({})
source_locale_dir = pj('src', '_locales')

build_tmp = pj(tmp_dir, config['clean_name'])
build_dir = osp.abspath(pj('dist', 'build', config['version']))


# fill 'descriptions'
for alpha2 in os.listdir(source_locale_dir):
    with open(pj(source_locale_dir, alpha2, 'messages.json'), encoding='utf-8') as f:
        string_data = json.load(f, object_pairs_hook=OrderedDict)

    descriptions[alpha2] = string_data['extShortDesc']['message']


# only needed for Safari
with open(pj(src_dir, 'locales.json'), 'wt', encoding='utf-8', newline='\n') as f:
    tmp = {
        '_': config['def_lang']
    }

    for alpha2 in descriptions:
        tmp[alpha2] = 1

    json.dump(tmp, f, sort_keys=True, ensure_ascii=False)


with open(pj(src_dir, 'js', 'vapi-appinfo.js'), 'r+t', encoding='utf-8', newline='\n') as f:
    tmp = f.read()
    f.seek(0)

    f.write(re.sub(
        r'/\*\*/([^:]+:).+',
        lambda m: '/**/' + m.group(1) + " '" + config[m.group(1)[:-1]] + "',",
        tmp
    ))


with open(pj(src_dir, vendors['crx']['manifest']), 'wt', encoding='utf-8', newline='\n') as f:
    cf_content = readfile(pj(meta_dir, 'crx', vendors['crx']['manifest']))

    f.write(
        re.sub(r"\{(?=\W)|(?<=\W)\}", r'\g<0>\g<0>', cf_content).format(**config)
    )


with open(pj(src_dir, vendors['safariextz']['manifest']['Info']), 'wt', encoding='utf-8', newline='\n') as f:
    config['app_id'] = vendors['safariextz']['app_id']
    config['description'] = descriptions[config['def_lang']]
    cf_content = readfile(pj(meta_dir, 'safariextz', vendors['safariextz']['manifest']['Info']))
    f.write(cf_content.format(**config))

copy(pj(meta_dir, 'safariextz', vendors['safariextz']['manifest']['Settings']), pj(src_dir, vendors['safariextz']['manifest']['Settings']))


if 'meta' in sys.argv:
    raise SystemExit('Metadata generated.')


rmtree(tmp_dir)
mkdirs(tmp_dir)

rmtree(build_dir)
mkdirs(build_dir)

# create update meta
for vendor, ext in {'crx': 'xml', 'safariextz': 'plist'}.items():
    with open(pj(build_dir, 'update_' + vendor + '.' + ext), 'wt', encoding='utf-8', newline='\n') as f:
        if vendor == 'safariextz':
            config['developer_identifier'] = vendors[vendor]['developer_identifier']

        config['app_id'] = vendors[vendor]['app_id']
        cf_content = readfile(pj(meta_dir, vendor, 'update_' + vendor + '.' + ext))
        f.write(cf_content.format(**config))
        f.close()


# separate vendor specific code
for vapijsfile in [pj(src_dir, 'js', 'vapi-' + jsfile + '.js') for jsfile in ['background', 'common', 'client']]:
    vapijs = readfile(vapijsfile)

    # "» name" is the start marker, "«" is the end marker
    js_parts = re.findall(r'»\s*(\w+)\n([^«]+)//', vapijs)

    if not js_parts:
        continue

    js_header = js_parts.pop(0)[1]
    js_footer = js_parts.pop()[1]

    for js in js_parts:
        with open(pj(tmp_dir, js[0] + '_' + osp.basename(vapijsfile)), 'wt', encoding='utf-8', newline='\n') as f:
            f.write(js_header)
            f.write(re.sub(r'^    ', '', js[1], flags=re.M))
            f.write(js_footer)


def move_vendor_specific_js(vendor):
    for file in ['background', 'common', 'client']:
        move(pj(tmp_dir, vendor + '_vapi-' + file + '.js'), pj(build_tmp, 'js', 'vapi-' + file + '.js'))


def copy_vendor_files(files):
    for file in files:
        path = pj(src_dir, file)

        if osp.isdir(path):
            copytree(path, pj(build_tmp, file), copy_function=copy)
        else:
            copy(path, pj(build_tmp, file))


def remove_vendor_files(files):
    for file in files:
        path = pj(build_tmp, file)

        if osp.isdir(path):
            rmtree(path)
        else:
            os.remove(path)


def norm_cygdrive(path):
    return '/cygdrive/' + path[0] + path[2:].replace('\\', '/') if path[1] == ':' else path


mkdirs(build_tmp)

for file in glob.iglob(pj(src_dir, '*')):
    basename = osp.basename(file)

    if osp.isfile(file) and (file.endswith('.html') or basename == 'icon.png'):
        copy(file, pj(build_tmp, basename))
    elif osp.isdir(file) and basename not in ['_locales', 'locale']:
        copytree(file, pj(build_tmp, basename), copy_function=copy)

os.remove(pj(build_tmp, 'js', 'sitepatch-safari.js'))


package_name = config['clean_name'] + '-' + config['version']


# Chrome
if not iscmd('7z'):
    print('Cannot build for Chrome: `7z` command not found.')
else:
    vendor_files = ['_locales', 'manifest.json']

    move_vendor_specific_js('crx')
    copy_vendor_files(vendor_files)

    package = pj(build_dir, package_name + '.zip')
    subprocess.call('7z a -r -tzip -mx=8 "' + norm_cygdrive(package) + '" "' + norm_cygdrive(pj(build_tmp, '*')) + '"', stdout=subprocess.DEVNULL)

    if osp.exists(vendors['crx']['private_key']):
        if not iscmd('openssl'):
            print('Cannot build for Chrome: `openssl` command not found.')
        else:
            # Convert the PEM key to DER (and extract the public form) for inclusion in the CRX header
            derkey = subprocess.Popen([
                'openssl', 'rsa', '-pubout',
                '-inform', 'PEM',
                '-outform', 'DER',
                '-in', norm_cygdrive(vendors['crx']['private_key'])
            ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.read()
            # Sign the zip file with the private key in PEM format
            signature = subprocess.Popen([
                'openssl', 'sha1',
                '-sign', norm_cygdrive(vendors['crx']['private_key']),
                norm_cygdrive(package)
            ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.read()
            out = open(package.replace('.zip', vendors['crx']['file_ext']), "wb")
            # Extension file magic number
            out.write(bytes("Cr24\x02\x00\x00\x00", 'UTF-8') + len(derkey).to_bytes(4, 'little') + len(signature).to_bytes(4, 'little'))
            out.write(derkey)
            out.write(signature)
            out.write(readfile(package, 'rb'))
            out.close()

        subprocess.call('7z a ' + norm_cygdrive(package) + ' ' + norm_cygdrive(osp.abspath(vendors['crx']['private_key'])), stdout=subprocess.DEVNULL)

    remove_vendor_files(vendor_files)


# Safari
if not iscmd('xar'):
    print('Cannot build for Safari: `xar` command not found.')
elif osp.exists(vendors['safariextz']['cert_dir']):
    vendor_files = [
        '_locales',
        'locales.json',
        'Info.plist',
        'Settings.plist',
        pj('js', 'sitepatch-safari.js')
    ]

    move_vendor_specific_js('safariextz')
    copy_vendor_files(vendor_files)

    build_tmp = move(build_tmp, pj(tmp_dir, config['clean_name'] + '.safariextension'))

    # xar accepts only unix style directory separators
    package = pj(build_dir, package_name + vendors['safariextz']['file_ext']).replace('\\', '/');
    subprocess.call('xar -czf "' + package + '" --compression-args=9 --distribution --directory="' + osp.basename(tmp_dir) + '" ' + config['clean_name'] + '.safariextension', stderr=subprocess.DEVNULL)
    subprocess.call('xar --sign -f "' + package + '" --digestinfo-to-sign sfr_digest.dat --sig-size 256 ' + ' '.join('--cert-loc="' + vendors['safariextz']['cert_dir'] + 'cert0{0}"'.format(i) for i in range(3)), stderr=subprocess.DEVNULL)
    subprocess.call('openssl rsautl -sign -inkey ' + vendors['safariextz']['private_key'] + ' -in sfr_digest.dat -out sfr_sig.dat', stderr=subprocess.DEVNULL)
    subprocess.call('xar --inject-sig sfr_sig.dat -f "' + package + '"', stderr=subprocess.DEVNULL)

    os.remove('sfr_sig.dat')
    os.remove('sfr_digest.dat')

    build_tmp = move(build_tmp, pj(tmp_dir, config['clean_name']))

    remove_vendor_files(vendor_files)


rmtree(tmp_dir)

print("Files ready @ " + build_dir)
