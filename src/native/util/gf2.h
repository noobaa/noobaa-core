/* Copyright (C) 2016 NooBaa */
#pragma once

#include "common.h"
#include <math.h>

namespace noobaa
{

/**
 *
 * GALOIS FIELD ARITHMETICS
 *
 * (finite field with 2^degree elements)
 *
 * Use cases: rabin fingerprinting, erasure coding.
 *
 * The type T should have enough bits to handle the degree of the polynom.
 *
 * TODO: support multiply, divide, invert using log tables if applicable for the degree.
 */
template <typename _T>
class GF2
{
public:
    typedef _T T;

    explicit GF2(int degree_, T poly_)
        : degree(degree_)
        , poly(poly_)
        , antimask((~(T(0)) >> degree) << degree)
        , mask(~antimask)
        , carry_bit_shift(degree - 1)
        , carry_byte_shift(degree - 8)
    {
        assert(degree > 8);
        assert(necessary_check_for_irreducible());
        for (int i = 0; i < 256; ++i) {
            T a = T(i) << carry_byte_shift;
            for (int j = 0; j < 8; ++j) {
                a = shift_left(a);
            }
            carry_byte_shift_table[i] = a;
        }
    }

    /**
     * check that poly is indeed ireeducible using a necessary (yet not sufficient) condition
     * by checking that 2^(2^degree) = 2 (mod p)
     */
    bool necessary_check_for_irreducible() const
    {
        static const T TWO = 2;
        T a = TWO;
        for (int i = 0; i < degree; ++i) {
            a = mult(a, a);
        }
        return a == TWO;
    }

    inline T shift_left(T a) const
    {
        if (a >> carry_bit_shift) {
            return ((a << 1) & mask) ^ poly;
        } else {
            return a << 1;
        }
    }

    T shifts_left(T a, int bits) const
    {
        while (bits >= 8) {
            a = shift_byte_left(a);
            bits -= 8;
        }
        while (bits > 0) {
            a = shift_left(a);
            bits -= 1;
        }
        return a;
    }

    inline T shift_byte_left(T a) const
    {
        return ((a << 8) & mask) ^ carry_byte_shift_table[a >> carry_byte_shift];
    }

    T mod(T a) const
    {
        int d = deg(a) - degree;
        while (d >= 0) {
            a ^= (poly << d);
            d = deg(a) - degree;
        }
        return a;
    }

    T mult(T a, T b) const
    {
        T result = 0;

        while (a && b) {
            // in every stage of the loop we add (which is xor in GF) a to
            // the result if b has the lowest bit on, which means that in polynom
            // representation b(x) = ... + 1
            if (b & 1) {
                result ^= a;
            }
            // in polynom notation we now do b=b/x a=a*x (mod p).
            b >>= 1;
            a = shift_left(a);
        }
        return result;
    }

    static int deg(T a)
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

    const int degree;
    const T poly;
    const T antimask;
    const T mask;
    const int carry_bit_shift;
    const int carry_byte_shift;

    // static const int byte_deg_table[256];

private:
    T carry_byte_shift_table[256];
};

} // namespace noobaa
