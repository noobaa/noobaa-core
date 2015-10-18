#ifndef NOOBAA__DEDUP__H
#define NOOBAA__DEDUP__H

#include "../util/common.h"
#include "../util/buf.h"

namespace noobaa {

/**
 *
 * DEDUP variable length chunking with sliding window hashing
 *
 */
template <typename _Hasher>
class Dedup
{
public:
    typedef _Hasher Hasher;
    typedef typename Hasher::T T;

    /**
     * The Dedup class defines a dedup policy.
     */
    explicit Dedup(
        const Hasher& hasher,
        int window_len,
        int min_chunk,
        int max_chunk,
        int avg_chunk_bits,
        T avg_chunk_val)
        : _hasher(hasher)
        , _window_len(window_len)
        , _min_chunk(min_chunk)
        , _max_chunk(max_chunk)
        , _avg_chunk_bits(avg_chunk_bits)
        , _avg_chunk_mask( ~((~T(0)) >> avg_chunk_bits << avg_chunk_bits) )
        , _avg_chunk_val(avg_chunk_val & _avg_chunk_mask)
    {
    }

private:
    const Hasher& _hasher;
    // window length in bytes for rolling hash
    const int _window_len;
    // minimum chunk length to avoid too small chunks, also used to fast skip for performance
    const int _min_chunk;
    // maximum chunk length to avoid too large chunks
    const int _max_chunk;
    // number of lower bits of the fingerprint used to match the hash value
    const int _avg_chunk_bits;
    // computed mask to pick just avg_chunk_bits lower bits
    const T _avg_chunk_mask;
    // hash value to match lower bits, can be any  value, but constant
    const T _avg_chunk_val;

public:

    /**
     * The Window class is used to perform chunking with sliding window.
     */
    class Window
    {
public:
        explicit Window(const Dedup& dedup)
            : _dedup(dedup)
            , _window(new uint8_t[_dedup._window_len])
        {
            reset();
        }

        ~Window()
        {
            delete[] _window;
        }

        inline void reset()
        {
            _hash = 0;
            _chunk_len = 0;
            _window_pos = 0;
            memset(_window, 0, _dedup._window_len);
        }

        /**
         * returns 0 if no chunk boundary,
         *      in this case more data can be pushed till boundary will be found.
         * returns offset between 1 and len (including) to set chunk boundary,
         *      in this case the window was reset and the rest of the data from offset
         *      should be pushed to find next chunk boundary.
         */
        int push(const uint8_t* data, int len);

private:
        const Dedup& _dedup;
        T _hash;
        int _chunk_len;
        int _window_pos;
        uint8_t* _window;
    };

};

} // namespace noobaa

#include "dedup.hpp"

#endif // NOOBAA__DEDUP__H
