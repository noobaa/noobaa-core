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

    /**
     * The Dedup class idefines a dedup policy.
     */
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

public:

    /**
     * The Chunker class is used to perform chunking with sliding window.
     */
    class Chunker
    {
public:

        explicit Chunker(const Dedup& dedup)
            : _dedup(dedup)
            , _window(new uint8_t[_dedup._window_len])
        {
            reset();
        }

        ~Chunker()
        {
            delete[] _window;
        }

        inline void reset()
        {
            _hash = 0;
            _window_pos = 0;
            _chunk_len = 0;
            memset(_window, 0, _dedup._window_len);
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

        inline bool has_chunks()
        {
            return !_chunks.empty();
        }

        inline Buf pop_chunk()
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

};

#include "dedup.hpp"

#endif // DEDUP_H_
