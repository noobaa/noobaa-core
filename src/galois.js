/* jshint node:true */
'use strict';

var _ = require('underscore');
var assert = require('assert');

// x,y are expected to be 8 bit integers - 0,1,...,255
function gf_256_mult_poly(x, y) {
    var res = 0;
    var bit, poly;

    for (bit = 1; bit < 0x100; bit <<= 1, x <<= 1) {
        if (y & bit) {
            res ^= x;
        }
    }
    // calculate modulo the polynom 0x11B
    // 0x11B is the irreducible polynom x^8 + x^4 + x^3 + x + 1
    // using long polynom division
    for (poly = 0x11B << 7, bit = 1 << 15; bit >= 0x100; poly >>= 1, bit >>= 1) {
        if (res & bit) {
            res ^= poly;
        }
    }
    return res;
}

function test_gf_256_mult_poly() {
    var table = [];
    var x, y, z, xs, ys, zs;
    var row, res;

    for (x = 0; x < 256; x++) {
        xs = x.toString(2);
        row = table[x] = {
            mult: [],
            inverse: 0,
        };

        for (y = 0; y < 256; y++) {
            ys = y.toString(2);
            res = row.mult[y] = gf_256_mult_poly(x, y);
            assert(res < 256 && res >= 0, 'bad result not a byte');

            if (y < x) {
                assert.strictEqual(res, table[y].mult[x],
                    'not commutative ' + xs + ' ' + ys);
            }

            if (res === 1) {
                assert(!row.inverse);
                row.inverse = y;
            }
        }

        if (x) {
            assert(row.inverse, 'missing inverse for ' + xs);
            if (x > row.inverse) {
                assert.strictEqual(x, table[row.inverse].inverse,
                    'mismatching inverse ' + xs);
            }
        }
    }

    var mult = function(x, y) {
        return table[x].mult[y];
    }

    for (x = 0; x < 256; x++) {
        for (y = 0; y < 256; y++) {
            for (z = 0; z < 256; z++) {
                assert.strictEqual(mult(x, y ^ z), mult(x, y) ^ mult(x, z));
                assert.strictEqual(mult(x, mult(y, z)), mult(mult(x, y), z));
            }
        }
    }
}

if (require.main === module) {
    test_gf_256_mult_poly();
}
