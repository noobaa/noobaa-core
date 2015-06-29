#ifndef POLY_H_
#define POLY_H_

#include "common.h"
#include <math.h>

template <typename T>
class Poly
{
public:
    Poly(T poly_, int degree_)
        : poly(poly_)
        , degree(degree_)
        , carry_byte_shift(degree-9)
        , carry_bit(T(1) << (degree-1))
        , carry_byte(T(0xFF) << carry_byte_shift)
        , antimask((~(T(0)) >> degree) << degree)
        , mask(~antimask)
    {
        assert(degree > 8);
        for (int i=0; i<256; ++i) {
            T a = T(i) << carry_byte_shift;
            for (int i=0; i<8; ++i) {
                a = shift_left(a);
            }
            carry_byte_shift_table[i] = a;
        }
    }

    inline T shift_left(T a) const
    {
        T carry = a & carry_bit;
        if (carry) {
            return ((a & ~carry_bit) << 1) ^ poly;
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
        T carry = (a & carry_byte) >> carry_byte_shift;
        return ((a << 8) & mask) ^ carry_byte_shift_table[carry];
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

    const T poly;
    const int degree;
    const int carry_byte_shift;
    const T carry_bit;
    const T carry_byte;
    const T antimask;
    const T mask;

    // a constant hash table from bytes to values with more bits
    // this is used when hashing byte-by-byte to avoid repeating bytes of zeros or other values
    static const T byte_const_hash[256];

    // static const int byte_deg_table[256];

private:
    T carry_byte_shift_table[256];
};

#endif // POLY_H_
