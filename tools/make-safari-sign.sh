#!/usr/bin/env bash

CERT=dist/certs
DES="${1/safariextension/safariextz}"

# Check if mackyle fork is installed (brew install xar-mackyle)
if ! which xar-mackyle > /dev/null 2>&1; then
    if [ ! -f ./tools/xar ]; then
        # Compile patched xar
        curl https://github.com/downloads/mackyle/xar/xar-1.6.1.tar.gz
        tar xf xar-1.6.1.tar.gz
        cd xar-1.6.1
        ./configure --disable-shared > /dev/null
        if [ "$?" -ne 0 ]; then
            echo 'Error: could not compile xar-mackyle'
            cd ..
            exit 1
        fi
        make
        mv src/xar ../tools/xar-mackyle
        cd ..
        rm -rf xar-1.6.1 xar-1.6.1.tar.gz
    fi
    alias xar-mackyle="$(pwd)/tools/xar-mackyle"
fi

siglen="$CERT/siglen.txt"
if [ ! -f "$siglen" ]; then
    openssl dgst -sign "$CERT/key.pem" -binary < "$CERT/key.pem" | wc -c > "$siglen"
fi

# Create archive
xar-mackyle -czf "$DES" \
    --distribution \
    --directory "${1%/*}" \
    "${1##*/}"

# Create digest
xar-mackyle --sign -f "$DES" --digestinfo-to-sign "$CERT/digestinfo.dat" \
    --sig-size "$(cat "$siglen")" \
    --cert-loc "$CERT/SafariDeveloper.cer" \
    --cert-loc "$CERT/AppleWWDRCA.cer" \
    --cert-loc "$CERT/AppleIncRootCertificate.cer"

# Create RSA signature
openssl rsautl -sign -inkey "$CERT/key.pem" -in "$CERT/digestinfo.dat" -out "$CERT/signature.dat"

# Sign archive
xar-mackyle --inject-sig "$CERT/signature.dat" -f "$DES"

rm -f "$CERT/signature.dat" "$CERT/digestinfo.dat"

unalias xar-mackyle > /dev/null 2>&1
