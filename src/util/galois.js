/* jshint node:true */
'use strict';

var _ = require('lodash');

module.exports = GF;


/**
 *
 * binary galois field GF(2^w)
 *
 * @param w the number of bits to use, max is 32
 * @param p (optional) a primitive polynom of degree w.
 *
 */
function GF(w, p) {
    this.w = w;
    this.p = p || GF.PRIMITIVE_POLYNOMS[w];

    // TODO width is limited to 32 bits because js limit on bitwise ops
    if (this.w > 32) {
        throw new Error('width too big ' + this.w);
    }

    if (!this.p) {
        throw new Error('no primitive polynom for width ' + this.w);
    }

    if (typeof(this.w) !== 'number' || typeof(this.p) !== 'number') {
        throw new Error('expected number args');
    }

    this.max = ~0 << (32 - this.w) >>> (32 - this.w);
    this.high_bit = 1 << (this.w - 1);
}

// http://web.eecs.utk.edu/~plank/plank/papers/CS-07-593/primitive-polynomial-table.txt
// TODO keep the full list of primitive polynoms
GF.PRIMITIVE_POLYNOMS = {
    2: mk_poly(2, 1, 0),
    3: mk_poly(3, 1, 0),
    4: mk_poly(4, 1, 0),
    5: mk_poly(5, 2, 0),
    6: mk_poly(6, 1, 0),
    7: mk_poly(7, 1, 0),
    8: mk_poly(8, 4, 3, 2, 0),
    9: mk_poly(9, 4, 0),
    10: mk_poly(10, 3, 0),
    11: mk_poly(11, 2, 0),
    12: mk_poly(12, 6, 4, 1, 0),
    13: mk_poly(13, 4, 3, 1, 0),
    14: mk_poly(14, 5, 3, 1, 0),
    15: mk_poly(15, 1, 0),
    16: mk_poly(16, 5, 3, 2, 0),
    // 16: 0x1100b,
    // 16: 0x138cb,
    17: mk_poly(17, 3, 0),
    18: mk_poly(18, 5, 2, 1, 0),
    19: mk_poly(19, 5, 2, 1, 0),
    20: mk_poly(20, 3, 0),
    21: mk_poly(21, 2, 0),
    22: mk_poly(22, 1, 0),
    23: mk_poly(23, 5, 0),
    24: mk_poly(24, 4, 3, 1, 0),
    25: mk_poly(25, 3, 0),
    26: mk_poly(26, 6, 2, 1, 0),
    27: mk_poly(27, 5, 2, 1, 0),
    28: mk_poly(28, 3, 0),
    29: mk_poly(29, 2, 0),
    30: mk_poly(30, 6, 4, 1, 0),
    31: mk_poly(31, 3, 0),
    32: mk_poly(32, 7, 5, 3, 2, 1, 0),
};

GF.mk_poly = mk_poly;

function mk_poly() {
    var p = 0;
    _.each(_.uniq(_.toArray(arguments)), function(i) {
        // workaround sign bit effects with bitwise ops
        // by multiplying batches of 30 bits
        if (i <= 30) {
            p += 1 << i;
            return;
        }
        var pi = 1;
        while (i > 30) {
            pi *= 1 << 30;
            i -= 30;
        }
        pi *= 1 << i;
        p += pi;
    });
    return p;
}


/**
 *
 * mult_with_modulo
 *
 * calculate a * b in GF(2^w)
 * expects: deg(a), deg(b) < w.
 *
 * the calculation is done by multiplying a and b as polynoms modulo p.
 * the modulo is used also during the polynom multiplication to avoid overflow.
 * see http://en.wikipedia.org/wiki/Finite_field_arithmetic#Rijndael.27s_finite_field
 *
 */
GF.prototype.mult_with_modulo = function(a, b) {
    var result = 0;

    while (a && b) {
        // in every stage of the loop we "add" (which is xor in GF) a to
        // the result if b has the lowest bit on, which means that in polynom
        // representation b(x) = ... + 1
        if (b & 1) {
            result ^= a;
        }
        // in polynom notation we now do b=b/x a=a*x (mod p).
        b >>>= 1;
        a = this.shift_left(a);
    }
    return result;
};


/**
 * use mult_with_modulo by default, unless overriden by init_log_table.
 */
GF.prototype.mult = GF.prototype.mult_with_modulo;


/**
 *
 * shift_left
 *
 * in polynom notation we return a(x) * x (mod p).
 * in binary notation we shift left and then xor with p if needed,
 * while avoiding overflow from 32 bit.
 *
 */
GF.prototype.shift_left = function(a) {
    var carry = a & this.high_bit;
    a <<= 1;
    if (carry) {
        a ^= this.p;
        a &= this.max; // masking
    }
    return a;
};



/**
 *
 * init_log_table
 *
 * generate log and exp tables for the primitive polynom.
 *
 * requirements:
 * w <= 24 because it will require lots of memory.
 * p must be a primitive polynom (and not just irreducible).
 *
 */
GF.prototype.init_log_table = function() {
    // the log & exp table keeps total of 8 bytes per element (4 in each table).
    // with more than 2^24 elements (16 M) this becomes quite heavy in memory.
    if (this.w > 24) {
        return false;
    }

    var log_table = new Uint32Array(this.max + 1);
    var exp_table = new Uint32Array(this.max + 1);
    log_table[0] = undefined;
    exp_table[0] = 0;

    // the process starts from the polynom a=1 and on each step it
    // multiplies a by the polynom x, which effectively means: a<<1 mod p.
    // when p is a primitive polynom this loop will iterate through all the
    // elements of GF(2^w) in the order of exponents - 1, x, x^2, x^3, ...
    var i = 0;
    var a = 1;
    do {
        // check if a repeats previous element
        // if so it means that p is not primitive.
        if (log_table[a]) {
            return false;
        }
        log_table[a] = i;
        exp_table[i] = a;
        i += 1;
        a = this.shift_left(a);
    } while (a !== 1);

    // override the mult function to use the log tables
    this.log_table = log_table;
    this.exp_table = exp_table;
    this.mult = this.mult_with_log;
    return true;
};


/**
 * calculate a * b in GF(2^w) using the log and exp tables.
 * using the formula: a * b = exp( log(a) + log(b) )
 */
GF.prototype.mult_with_log = function(a, b) {
    if (!a || !b) {
        return 0;
    }
    var l = this.log_table[a] + this.log_table[b];
    if (l >= this.max) {
        l -= this.max;
    }
    return this.exp_table[l];
};


/**
 * calculate a / b in GF(2^w) using the log and exp tables.
 * using the formula: a / b = exp( log(a) - log(b) )
 */
GF.prototype.div_with_log = function(a, b) {
    if (!a) {
        return 0;
    }
    if (!b) {
        return undefined;
    }
    var l = this.log_table[a] - this.log_table[b];
    if (l < 0) {
        l += this.max;
    }
    return this.exp_table[l];
};

/**
 * find the inverse of a using: exp( log(a) + log(a^-1) ) = 1
 * so log(a^-1) = 2^w - log(a)
 */
GF.prototype.inverse = function(a) {
    if (!a) {
        return undefined;
    }
    var l = this.max - this.log_table[a] + 1;
    return this.exp_table[l];
};

GF.prototype.log = function(a) {
    return this.log_table[a];
};

GF.prototype.exp = function(l) {
    return this.exp_table[l];
};




/**
 *
 * poly_modulo
 *
 * calculate a modulo b using long polynom division.
 *
 * NOTE: this is a *slow* implementation because it makes no assumptions.
 * for faster code see how mult_with_modulo handles modulo with single xor
 * by assuming only the w bit might become set during it's operation.
 *
 * here is a long division example:
 *  w = 2
 *  b = 0x7   =       111 = x^2 + x + 1
 *  a = 0x1fc = 111111100 = x^8 + x^7 + x^6 + x^5 + x^4 + x^3 + x^2
 *  d = deg(a)-w = 6
 *	===========
 * 	  111111100 	--> result = a
 *  ^ 111			--> b << d, d=6
 * 	===========
 *	     111100 	--> result
 *  ^    111		--> b << d, d=3
 * 	===========
 *	        100		--> result
 *  ^       111		--> b << d, d=0
 * 	===========
 *	         11		--> result - a mod b
 *
 */
function poly_modulo(a, p, w) {
    var result = a;
    var d = poly_degree(a) - w;

    // in each loop we subtract (xor) with b shifted exactly to cancel
    // the next highest bit of result, until the result degree is less than w.
    while (d >= 0) {
        result ^= (p << d);
        d = poly_degree(result) - w;
    }
    return result;
}


/**
 *
 * poly_degree
 *
 * return the polynom degree of a.
 *
 * note that deg(0) = deg(1) = 0 because both 0 and 1 represent a
 * constant polynom of degree 0.
 *
 * more examples:
 * deg(7)=2 because 7 has the polynom form of: x^2 + x + 1
 * deg(0x1001)=12 because 0x1001 has the polynom form of: x^12 + 1
 *
 */
function poly_degree(a) {
    var n = 0;

    // checking bits: 1111 1111 1111 1111 0000 0000 0000 0000
    if (a & 0xFFFF0000) {
        n += 16;
        a >>>= 16;
    }
    // checking bits: 0000 0000 0000 0000 1111 1111 0000 0000
    if (a & 0xFF00) {
        n += 8;
        a >>>= 8;
    }
    // checking bits: 0000 0000 0000 0000 0000 0000 1111 0000
    if (a & 0xF0) {
        n += 4;
        a >>>= 4;
    }
    // checking bits: 0000 0000 0000 0000 0000 0000 0000 1100
    if (a & 0xC) {
        n += 2;
        a >>>= 2;
    }
    // checking bits: 0000 0000 0000 0000 0000 0000 0000 0010
    if (a & 0x2) {
        n += 1;
    }
    return n;
}


// static functions
GF.poly_degree = poly_degree;
GF.poly_modulo = poly_modulo;
