/* Copyright (C) 2016 NooBaa */
'use strict';

const crypto = require('crypto');

const ALPHA_NUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function crypto_random_string(len, charset = ALPHA_NUMERIC_CHARSET) {
    // In order to not favor any specific chars over others we limit the maximum random value
    // we can use modulo charset.length.
    // By limiting to a whole multiple of charset.length we make sure our modulo is aligned to the random range.
    // However we have to ignore values above that max, so we need to surround with another loop
    // to fill the entire desired length.
    const max_uint32 = Math.pow(2, 32);
    const max_random = max_uint32 - (max_uint32 % charset.length);
    let str = '';
    do {
        const left = len - str.length;
        const rand = crypto.randomBytes(left * 4);
        for (let i = 0; i < left; ++i) {
            const n = rand.readUInt32BE(i * 4);
            if (n < max_random) {
                str += charset.charAt(n % charset.length);
            }
        }
    } while (str.length !== len);
    return str;
}

function left_pad_zeros(str, to_length) {
    let num_zeros = to_length - str.length;
    let zeros = '';
    if (num_zeros > 0) {
        zeros = '0'.repeat(num_zeros);
    }
    return zeros + str;

}

/**
 * Compute text edit-distance used as a similarity score
 * https://en.wikipedia.org/wiki/Levenshtein_distance
 */
function levenshtein_distance(s, t, fuzzy, stop_marker) {
    // degenerate cases
    if (s === t) return 0;
    if (s.length === 0) return t.length;
    if (t.length === 0) return s.length;

    // create two work vectors of integer distances
    const v0 = [];
    const v1 = [];
    v0.length = v1.length = t.length + 1;

    // initialize v0 (the previous row of distances)
    // this row is A[0][i]: edit distance for an empty s
    // the distance is just the number of characters to delete from t
    // init to i to count deletions per offset
    // init to 0 to allow "fuzzy" search
    for (let i = 0; i < v0.length; ++i) {
        if (fuzzy === 'fuzzy') {
            v0[i] = 0;
        } else {
            v0[i] = i;
        }
    }

    for (let i = 0; i < s.length; ++i) {
        // calculate v1 (current row distances) from the previous row v0

        // first element of v1 is A[i+1][0]
        //   edit distance is delete (i+1) chars from s to match empty t
        v1[0] = i + 1;

        // use formula to fill in the rest of the row
        for (let j = 0; j < t.length; ++j) {
            var cost = (s[i] === t[j]) ? 0 : 1;
            v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
        }

        // copy v1 (current row) to v0 (previous row) for next iteration
        // bail if we already passed the stop marker, to allow to drop matches faster
        var min = Infinity;
        for (let j = 0; j < v0.length; ++j) {
            v0[j] = v1[j];
            if (min > v1[j]) {
                min = v1[j];
            }
        }
        if (min > stop_marker) {
            return Infinity;
        }
    }

    return v1[t.length];
}

function rolling_hash(str, roll_context) {
    // Calculate rabin karp rolling hash for strings
    // Basically for the string the string is (Ck, Cn-1, ... , C0)
    // this value is C0 + C1*A^1 + C2*A^2 + ... Ck*A^k mod N
    const c = roll_context;
    c.w = c.w || 16;
    c.a = c.a || 256;
    c.n = c.n || 0xfe147c95;
    c.pos = c.pos || 0;
    c.hash = c.hash || 0;
    c.window = c.window || [];
    if (!c.a2w) {
        c.a2w = 1;
        for (let i = 0; i < c.w; ++i) {
            c.a2w = (c.a2w * c.a) % c.n;
        }
    }
    for (let i = 0; i < str.length; ++i) {
        const in_value = str.charCodeAt(i);
        const out_value = c.window[c.pos] || 0;
        c.window[c.pos] = in_value;
        c.pos = (c.pos + 1) % c.w;
        const t1 = (c.hash * c.a) % c.n;
        const t2 = (out_value * c.a2w) % c.n;
        c.hash = t1 - t2 + in_value;
        while (c.hash < 0) c.hash += c.n;
        c.hash %= c.n;
    }
    return c.hash;
}


exports.ALPHA_NUMERIC_CHARSET = ALPHA_NUMERIC_CHARSET;
exports.crypto_random_string = crypto_random_string;
exports.left_pad_zeros = left_pad_zeros;
exports.levenshtein_distance = levenshtein_distance;
exports.rolling_hash = rolling_hash;
