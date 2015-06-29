#ifndef POLY_H_
#define POLY_H_

#include "common.h"
#include <math.h>

template <typename T>
class Poly
{
public:
    Poly(T poly, int degree)
        : _poly(poly)
        , _degree(degree)
        , _carry_bit(1ull << (_degree-1))
        , _carry_byte(0xFFull << (_degree-9))
    {
        for (int i=0; i<256; ++i) {
            T a = T(i) << (_degree-9);
            for (int i=0; i<8; ++i) {
                a = shift_left(a);
            }
            carry_byte_shift_table[i] = a;
            byte_deg_table[i] = i ? int(log2(i)) : 0;
        }
    }

    inline T shift_left(T a) const
    {
        T carry = a & _carry_bit;
        if (carry) {
            return ((a & ~_carry_bit) << 1) ^ _poly;
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
        T carry = (a & _carry_byte) >> (_degree-9);
        return ((a & ~_carry_byte) << 8) ^ carry_byte_shift_table[carry];
    }

    T mod(T a) const
    {
        int d = deg(a) - _degree;
        while (d >= 0) {
            a ^= (_poly << d);
            d = deg(a) - _degree;
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

    int deg(T a) const
    {
        int n = 0;
        while (a >> 8) {
            n += 8;
            a >>= 8;
        }
        return n + byte_deg_table[a];
    }

private:
    T _poly;
    int _degree;
    T _carry_bit;
    T _carry_byte;
    T carry_byte_shift_table[256];
    int byte_deg_table[256];
};

#endif // POLY_H_
