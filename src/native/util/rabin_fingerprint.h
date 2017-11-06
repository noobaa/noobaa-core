/* Copyright (C) 2016 NooBaa */
#pragma once

#include "gf2.h"

namespace noobaa
{

template <typename _GF>
class RabinFingerprint
{
public:
    typedef _GF GF;
    typedef typename GF::T T;

    explicit RabinFingerprint(const GF& gf, int window_len)
        : _gf(gf)
    {
        // the window_shift_table keeps the value of each byte once it falls off the sliding window
        // which is essentially: byte << window (mod p)
        for (int i = 0; i < 256; ++i) {
            window_shift_table[i] = _gf.shifts_left(_gf.mod(i), 8 * window_len);
        }
    }

    inline T update(T hash, uint8_t byte_in, uint8_t byte_out) const
    {
        // the current hash is shifted one byte left to make room for the new input byte.
        // for byte_out the window was shifted window*8 times so in order to cancel it
        // we use the window shift table.
        return _gf.shift_byte_left(hash) ^ byte_in ^ window_shift_table[byte_out];
    }

private:
    // polynom instance with needed shift/mod functions
    const GF& _gf;
    // see explanation in ctor
    T window_shift_table[256];
};

} // namespace noobaa
