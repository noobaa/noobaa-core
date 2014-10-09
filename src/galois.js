/* jshint node:true */
'use strict';

var _ = require('underscore');
var assert = require('assert');

function poly_degree(x) {
    var n = 0;
    if (x & 0xFFFF0000) {
        n += 16;
        x >>= 16;
    }
    if (x & 0xFFFFFF00) {
        n += 8;
        x >>= 8;
    }
    if (x & 0xFFFFFFF0) {
        n += 4;
        x >>= 4;
    }
    if (x & 0xFFFFFFFC) {
        n += 2;
        x >>= 2;
    }
    if (x & 0xFFFFFFFE) {
        n += 1;
    }
    return n;
}

// calculate x modulo p using long polynom division
function poly_modulo(w, p, x) {
    var ret = x;
    var d = poly_degree(ret) - w;
    while (d >= 0) {
        ret ^= (p << d);
        d = poly_degree(ret) - w;
    }
    return ret;
}

// multiply polynoms. modulo_func is optional.
function poly_mult(x, y, modulo_func) {
    var ret = 0;
    modulo_func = modulo_func || _.identity;
    while (x && y) {
        y = modulo_func(y);
        if (x & 1) {
            ret ^= y;
        }
        x >>= 1;
        y <<= 1;
    }
    return ret;
}

function gf_mult_with_poly(w, p, x, y) {
    // TODO avoid bind on every call
    return poly_mult(x, y, poly_modulo.bind(null, w, p));
}

function gf_prepare_tables(w, p) {
    var max = 1 << w;
    var i, a;
    var log_tab = [Infinity];
    var exp_tab = [1];
    assert(w <= 16, 'w too big');
    for (i = 1, a = p; i < max; i++) {
        log_tab[a] = i;
        exp_tab[i] = a;
        a = gf_mult_with_poly(w, p, p, a);
    }
    return {
        log: log_tab,
        exp: exp_tab,
    };
}

function gf_mult_with_tables(tables, x, y) {
    return (x && y) ? tables.exp[tables.log[x] + tables.log[y]] : 0;
}


function test_mult(w, mult_func) {
    var max = 1 << w;
    var x, y, z;
    var ret, ret2;
    var inverse = new Array(max);
    assert(w <= 16, 'w too big');

    for (x = 0; x < max && x < 10; x++) {
        for (y = 0; y < max; y++) {
            ret = mult_func(x, y);
            if (ret >= max || ret < 0) {
                throw new Error('bad result not in range ' +
                    x.toString(2) + ' * ' + y.toString(2) +
                    ' = ' + (ret && ret.toString(2)));
            }
			/*
            ret2 = mult_func(y, x);
            if (ret !== ret2) {
                throw new Error('not commutative ' +
                    x.toString(2) + ' * ' + y.toString(2) +
                    ' = ' + ret.toString(2) + ' or ' + ret2.toString(2));
            }
			*/
            if (ret === 1) {
                inverse[x] = inverse[x] || y;
                inverse[y] = inverse[y] || x;
                if (inverse[x] !== y) {
                    throw new Error('inverse already found for ' +
                        x.toString(2) + ' ' + inverse[x].toString(2));
                }
                if (inverse[y] !== x) {
                    throw new Error('inverse already found for column ' +
                        y.toString(2) + ' ' + inverse[y].toString(2));
                }
            }
            // for (z = 0; z < max; z++) {
            // assert.strictEqual(m(x, y ^ z), m(x, y) ^ m(x, z));
            // assert.strictEqual(m(x, m(y, z)), m(m(x, y), z));
            // }
        }
        if (x) {
            if (!inverse[x]) {
                throw new Error('missing inverse for ' + x.toString(2));
            }
            if (x > inverse[x]) {
                assert.strictEqual(x, inverse[inverse[x]],
                    'mismatching inverse ' + x.toString(2));
            }
        }
        process.stdout.write((x % 100 === 0 ? x.toString() : '.'));
    }

    process.stdout.write('\n');
}


if (require.main === module) {
    // 0x11B is irreducible polynom for GF(2^8): x^8 + x^4 + x^3 + x + 1
    // 0x1100B is irreducible polynom for GF(2^16): x^16 + x^12 + x^3 + x + 1
    console.log('GEN ',gf_mult_with_poly(8, 0x11d, 0x11d, 1));

    console.log('w=8 gf_mult_with_poly');
    test_mult(8, gf_mult_with_poly.bind(null, 8, 0x11b));

    console.log('w=16 gf_mult_with_poly');
    test_mult(16, gf_mult_with_poly.bind(null, 16, 0x1100b));

    console.log('w=8 gf_prepare_tables');
    var tables8 = gf_prepare_tables(8, 0x11d);
    console.log('w=8 gf_mult_with_tables');
    test_mult(8, gf_mult_with_tables.bind(null, tables8));


    console.log('w=16 gf_prepare_tables');
    var tables16 = gf_prepare_tables(16, 0x1100b);
    console.log('w=16 gf_mult_with_tables');
    test_mult(16, gf_mult_with_tables.bind(null, tables16));

    console.log('done');
}

module.exports = {
    poly_degree: poly_degree,
    poly_modulo: poly_modulo,
    poly_mult: poly_mult,
    gf_mult_with_poly: gf_mult_with_poly,
    gf_mult_with_tables: gf_mult_with_tables,
    gf_prepare_tables: gf_prepare_tables,
};
