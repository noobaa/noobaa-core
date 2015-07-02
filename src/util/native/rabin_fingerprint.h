#ifndef RABIN_H_
#define RABIN_H_

#include "gf2.h"

template <typename _Hash>
class RabinFingerprint
{
public:
    typedef _Hash Hash;

    explicit RabinFingerprint(int degree, Hash poly, int window_len) : _gf2(degree, poly)
    {
        // the window_shift_table keeps the value of each byte once it falls off the sliding window
        // which is essentially: byte << window (mod p)
        for (int i=0; i<256; ++i) {
            window_shift_table[i] = _gf2.shifts_left(_gf2.mod(i), 8 * window_len);
        }
    }

    inline Hash update(Hash hash, uint8_t byte_in, uint8_t byte_out) const
    {
        // the current hash is shifted one byte left to make room for the new input byte.
        // for byte_out the window was shifted window*8 times so in order to cancel it
        // we use the window shift table.
        return _gf2.shift_byte_left(hash)
               ^ byte_in
               ^ window_shift_table[byte_out];
    }

private:
    // polynom instance with needed shift/mod functions
    const GF2<Hash> _gf2;
    // see explanation in ctor
    Hash window_shift_table[256];
};

#endif // RABIN_H_
