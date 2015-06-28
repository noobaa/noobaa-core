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

template<typename Hasher_>
class Dedup
{
public:
    typedef Hasher_ Hasher;
    typedef typename Hasher::HashType HashType;
    typedef typename Hasher::Config HasherConf;
    class Config;

    explicit Dedup(const Config& conf, const HasherConf& hasher_conf)
        : _conf(conf)
        , _hasher(hasher_conf)
        , _current_len(0)
    {
    }

    ~Dedup() {
    }

    void push(Buf buf);

    void flush();

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
    const Config& _conf;
    Hasher _hasher;
    int _current_len;
    std::list<Buf> _slices;
    std::list<Buf> _chunks;
};


template<typename Hasher_>
class Dedup<Hasher_>::Config
{
public:
    explicit Config(
        int min_chunk_,
        int max_chunk_,
        int avg_chunk_bits_,
        HashType avg_chunk_val_)
        : min_chunk(min_chunk_)
        , max_chunk(max_chunk_)
        , avg_chunk_bits(avg_chunk_bits_)
        , avg_chunk_mask( ~((~HashType(0)) >> avg_chunk_bits_ << avg_chunk_bits_) )
        , avg_chunk_val(avg_chunk_val_ & avg_chunk_mask)
    {
        std::cout << "avg_chunk_val " << std::hex << avg_chunk_val << std::endl;
        std::cout << "avg_chunk_mask " << std::hex << avg_chunk_mask << std::endl;
    }
    /* minimum chunk length to avoid too small chunks, also used to fast skip for performance */
    const int min_chunk;
    /* maximum chunk length to avoid too large chunks */
    const int max_chunk;
    /* number of lower bits of the fingerprint used to match the hash value */
    const int avg_chunk_bits;
    /* computed mask to pick just avg_chunk_bits lower bits */
    const HashType avg_chunk_mask;
    /* hash value to match lower bits, can be any  value, but constant */
    const HashType avg_chunk_val;
};

#include "dedup.hpp"

#endif // DEDUP_H_
