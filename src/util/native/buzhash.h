#ifndef BUZHASH_H_
#define BUZHASH_H_

#include "common.h"

/**
 *
 * Cyclic polynomials hashing
 *
 * fast and good.
 *
 * http://arxiv.org/pdf/0705.4676v7.pdf
 *
 */
template <typename _Hash>
class BuzHash
{
public:
    typedef _Hash Hash;

    explicit BuzHash(int width, int window_len, int num_hash_bits) : _width(width)
    {

        // to make BuzHash pairwise independant (less sensitive to collision attacks)
        // we should remove (window_len-1) consecutive bits from the hash
        // so we can only use (width-window_len+1) bits from the resulting hash
        // assert(width - window_len + 1 >= num_hash_bits);

        // window_rotate_table is the value of the byte rotated 'window_len'-times
        // this allows to remove the last window byte.
        for (int i=0; i<256; ++i) {
            Hash a(i);
            for (int j=0; j<window_len; ++j) {
                a = rotate_byte_left(a);
            }
            window_rotate_table[i] = a;
        }
    }

    inline Hash rotate_byte_left(Hash a) const
    {
        return (a >> (_width - 8)) | (a << 8);
    }

    inline Hash update(Hash hash, uint8_t byte_in, uint8_t byte_out) const
    {
        return rotate_byte_left(hash)
               // for byte_in constant hash is used to translate every input byte before feeding it
               // to reduce the effect of sequences of zeros.
               ^ byte_const_hash[byte_in]
               ^ window_rotate_table[byte_out];
    }

private:
    // the number of bits in the hash
    const int _width;
    // see explaination in ctor
    Hash window_rotate_table[256];
    // a constant hash table from bytes to values with more bits
    // this is used when hashing byte-by-byte to avoid repeating bytes of zeros or other values
    static const Hash byte_const_hash[256];
};

#endif // BUZHASH_H_
