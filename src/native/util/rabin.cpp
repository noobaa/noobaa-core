/* Copyright (C) 2016 NooBaa */
#include "rabin.h"
#include <assert.h>
#include <stdbool.h>

namespace noobaa
{

Rabin::Rabin(Hash poly, int degree, int window_len)
    : _poly(poly)
    , _degree(degree)
    , _window_len(window_len)
    , _mask(~(((~(Hash)0) >> degree) << degree))
    , _carry_bit_shift(degree - 1)
    , _carry_byte_shift(degree - 8)
{
    assert(_carry_byte_shift > 0);
    assert(_degree < (int)sizeof(Hash) * 8);
    assert((_poly & _mask) == _poly);

    for (int i = 0; i < 256; ++i) {
        Hash a;

        // initialize shift_byte_table - used to optimize update()
        // by saving the values of the carry byte that should be added (xor) once each byte
        // is carried out of the mask.
        // this value is: byte << carry_byte_shift (mod p)
        // when shifting a byte left we carry the top bits - [carry 8 bits] [rest bits]
        // and the result is ([rest bits] << 8) ^ shift_byte_table([carry 8 bits])
        a = i;
        for (int j = 0; j < 8 * _carry_byte_shift; ++j) {
            a = _shift_bit_left(a);
        }
        _shift_byte_table[i] = a;

        // initialize window_shift_table - used to optimize update()
        // by saving the value of each byte as it will fall off the sliding window
        // this value is: byte << window (mod p)
        a = i;
        for (int j = 0; j < 8 * _window_len; ++j) {
            a = _shift_bit_left(a);
        }
        _window_shift_table[i] = a;
    }

    // necessary check for irreducible poly:
    // check that poly is indeed ireeducible using a necessary (yet not sufficient) condition
    // by checking that 2^(2^degree) = 2 (mod p)
    const Hash TWO = 2;
    Hash a = TWO;
    for (int i = 0; i < _degree; ++i) {
        a = _mult(a, a);
    }
    assert(a == TWO);
}

inline Rabin::Hash
Rabin::_shift_bit_left(Hash a)
{
    if (a >> _carry_bit_shift) {
        return ((a << 1) & _mask) ^ _poly;
    } else {
        return a << 1;
    }
}

inline Rabin::Hash
Rabin::_mult(Hash a, Hash b)
{
    Hash result = 0;

    while (a && b) {
        // in every stage of the loop we add (which is xor in GF) a to
        // the result if b has the lowest bit on, which means that in polynom
        // representation b(x) = ... + 1
        if (b & 1) result ^= a;
        // in polynom notation we now do b=b/x a=a*x (mod p).
        b >>= 1;
        a = _shift_bit_left(a);
    }
    return result;
}

inline Rabin::Hash
Rabin::_mod(Hash a)
{
    int d = _deg(a) - _degree;
    while (d >= 0) {
        a ^= (_poly << d);
        d = _deg(a) - _degree;
    }
    return a;
}

inline int
Rabin::_deg(Hash a)
{
    int n = 0;
    while (a > 0xff) {
        a >>= 8;
        n += 8;
    }
    while (a > 1) {
        a >>= 1;
        n += 1;
    }
    return n;
}
}