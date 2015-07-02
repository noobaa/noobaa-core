#ifndef DEDUP_H_
#define DEDUP_H_

#include "common.h"
#include "buf.h"

/**
 *
 * DEDUP addon for nodejs
 *
 * takes nodejs buffers and chunking them with variable length dedup
 *
 */

template <typename _Hasher>
class Dedup
{
public:
    typedef _Hasher Hasher;
    typedef typename Hasher::Hash Hash;

    explicit Dedup(
        const Hasher& hasher,
        int window_len,
        int min_chunk,
        int max_chunk,
        int avg_chunk_bits,
        Hash avg_chunk_val)
        : _hasher(hasher)
        , _window_len(window_len)
        , _min_chunk(min_chunk)
        , _max_chunk(max_chunk)
        , _avg_chunk_bits(avg_chunk_bits)
        , _avg_chunk_mask( ~((~Hash(0)) >> avg_chunk_bits << avg_chunk_bits) )
        , _avg_chunk_val(avg_chunk_val & _avg_chunk_mask)
    {
    }

    class Chunker
    {
public:

        explicit Chunker(const Dedup& dedup)
            : _dedup(dedup)
            , _hash(0)
            , _window(new uint8_t[_dedup._window_len])
            , _window_pos(0)
            , _chunk_len(0)
        {
            reset();
        }

        ~Chunker()
        {
            delete[] _window;
        }

        void reset()
        {
            _hash = 0;
            _window_pos = 0;
            _chunk_len = 0;
            // the initial value of the hash is inited with a window full of 1's
            // to prevent pathology of sequences of zeros on the hasher.
            for (int i=0; i<_dedup._window_len; ++i) {
                _window[i] = 1;
                _hash = _dedup._hasher.update(_hash, 1, 0);
            }
        }

        void push(Buf buf);

        void flush()
        {
            if (!_slices.empty()) {
                _chunks.push_back(Buf::concat(_slices.begin(), _slices.end(), _chunk_len));
                _slices.clear();
            }
            reset();
        }

        bool has_chunks()
        {
            return !_chunks.empty();
        }

        Buf pop_chunk()
        {
            Buf buf(_chunks.front());
            _chunks.pop_front();
            return buf;
        }

private:
        const Dedup& _dedup;
        Hash _hash;
        uint8_t* _window;
        int _window_pos;
        int _chunk_len;
        std::list<Buf> _slices;
        std::list<Buf> _chunks;
    };

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
    const Hash _avg_chunk_mask;
    // hash value to match lower bits, can be any  value, but constant
    const Hash _avg_chunk_val;

};

#include "dedup.hpp"

#endif // DEDUP_H_
