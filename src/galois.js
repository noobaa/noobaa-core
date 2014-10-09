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
    var log_tab = new Uint32Array(max);
    var exp_tab = new Uint32Array(max);
    log_tab[0] = undefined;
    exp_tab[0] = 1;
    var i = 0;
    var a = 1;
    do {
        // console.log('a**' + i, '=', a.toString(2));
        log_tab[a] = i;
        exp_tab[i] = a;
        a = poly_modulo(w, p, a << 1);
        i++;
    } while (a !== 1);
    return {
        len: max - 1,
        log: log_tab,
        exp: exp_tab,
    };
}

function gf_mult_with_tables(tables, x, y) {
    if (!x || !y) {
        return 0;
    }
    var l = tables.log[x] + tables.log[y];
    if (l >= tables.len) {
        l -= tables.len;
    }
    return tables.exp[l];
}


function test_mult(w, mult_func) {
    var max = 1 << w;
    var x, y, z;
    var ret, ret2;
    var inverse = new Array(max);

    console.log('test mult w=' + w);

    for (x = 0; x < max && x < 256; x++) {
        for (y = 0; y < max; y++) {
            ret = mult_func(x, y);
            // console.log(x.toString(2) + ' * ' + y.toString(2) +
            // ' = ' + (ret && ret.toString(2)));
            if (typeof(ret) !== 'number' || ret >= max || ret < 0) {
                throw new Error('bad result not in range ' +
                    x.toString(2) + ' * ' + y.toString(2) +
                    ' = ' + (ret && ret.toString(2)));
            }
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
            /*
			// checking field commutativity for (*)
            ret2 = mult_func(y, x);
            if (ret !== ret2) {
                throw new Error('not commutative ' +
                    x.toString(2) + ' * ' + y.toString(2) +
                    ' = ' + ret.toString(2) + ' or ' + ret2.toString(2));
            }
			*/
            /*
			// checking field distributivity for (+,*)
            for (z = 0; z < max; z++) {
            	assert.strictEqual(m(x, y ^ z), m(x, y) ^ m(x, z));
            	assert.strictEqual(m(x, m(y, z)), m(m(x, y), z));
            }
			*/
        }
        if (x) {
            if (!inverse[x]) {
                throw new Error('missing inverse for ' + x.toString(2));
            }
            if (x > inverse[x] && x !== inverse[inverse[x]]) {
                throw new Error('mismatching inverse ' + x.toString(2) +
                    ' ' + (inverse[inverse[x]] && inverse[inverse[x]].toString(2)));
            }
        }
        process.stdout.write((x % 100 === 0 ? x.toString() : '.'));
    }

    process.stdout.write('\n');
}

function test_mult_with_tables(w, p) {
    console.log('\nprepare tables w=' + w);
    var tables = gf_prepare_tables(w, p);
    test_mult(w, gf_mult_with_tables.bind(null, tables));
    console.log('done');
}


if (require.main === module) {
    // 0x7 is primitive polynom for GF(2^2): x^2 + x + 1
    // 0x13 is primitive polynom for GF(2^4): x^4 + x + 1
    // 0x11d is primitive polynom for GF(2^8): x^8 + x^4 + x^3 + x + 1
    // 0x1100b is primitive polynom for GF(2^16): x^16 + x^12 + x^3 + x + 1

    test_mult_with_tables(2, 0x7);
    test_mult_with_tables(4, 0x13);
    test_mult_with_tables(8, 0x11d);
    test_mult_with_tables(16, 0x1100b);

    test_mult(2, gf_mult_with_poly.bind(null, 2, 0x7));
    test_mult(4, gf_mult_with_poly.bind(null, 4, 0x13));
    test_mult(8, gf_mult_with_poly.bind(null, 8, 0x11d));
    // test_mult(16, gf_mult_with_poly.bind(null, 16, 0x1100b));

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
