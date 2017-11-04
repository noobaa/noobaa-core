/* Copyright (C) 2016 NooBaa */
#pragma once

#include <stdint.h>

namespace noobaa
{

class Rabin
{
public:
    typedef uint64_t Hash;

    Rabin(Hash poly, int degree, int window_len);

    inline Hash
    update(Hash hash, uint8_t byte_in, uint8_t byte_out)
    {
        // the current hash is shifted one byte left to make room for the new input byte
        return ((hash << 8) & _mask)
            // using a table to add the 8 bits that got carried (mod p)
            ^ _shift_byte_table[hash >> _carry_byte_shift]
            // removing byte_out - since the window was shifted window_len*8 times since
            // byte_out was added, we use a table to add: byte_out << window_len*8 (mod p)
            ^ _window_shift_table[byte_out]
            // adding the new byte
            ^ byte_in;
    }

private:
    Hash _poly;
    int _degree;
    int _window_len;
    Hash _mask;
    int _carry_bit_shift;
    int _carry_byte_shift;
    Hash _shift_byte_table[256];
    Hash _window_shift_table[256];

    inline Hash _shift_bit_left(Hash a);
    inline Hash _mult(Hash a, Hash b);
    inline Hash _mod(Hash a);
    inline int _deg(Hash a);
};
}
