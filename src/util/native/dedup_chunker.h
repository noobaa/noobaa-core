#ifndef DEDUP_CHUNKER_H_
#define DEDUP_CHUNKER_H_

#include "common.h"
#include "dedup.h"
#include "rabin_fingerprint.h"
#include "tpool.h"

/**
 *
 * DedupChunker
 *
 * Performs variable length dedup.
 *
 */

class DedupChunker : public Nan::ObjectWrap
{
private:
    explicit DedupChunker()
        : _dedup_window(_deduper)
        , _chunk_len(0)
    {
    }

    virtual ~DedupChunker()
    {
    }

private:
    class Worker;
    typedef uint64_t T;
    typedef GF2<T> GF;
    typedef RabinFingerprint<GF> RabinHasher;
    typedef Dedup<RabinHasher> Deduper;
    static const int GF_DEGREE = 63; // high degree to allow higher AVG_CHUNK_BITS in the future
    static const T GF_POLY = 0x3;
    static const int WINDOW_LEN = 64; // limit the context of the fingerprint to 64 bytes window
    static const int MIN_CHUNK = 3 * 128 * 1024;
    static const int MAX_CHUNK = 6 * 128 * 1024;
    static const int AVG_CHUNK_BITS = 17; // 128K above MIN
    static const T AVG_CHUNK_VAL = ~T(0); // arbitrary fixed value
    static GF _gf;
    static RabinHasher _rabin_hasher;
    static Deduper _deduper;
    Deduper::Window _dedup_window;
    std::list<Buf> _chunk_slices;
    int _chunk_len;

public:
    static NAN_MODULE_INIT(setup);
private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
    static NAN_METHOD(flush);
};

#endif // DEDUP_CHUNKER_H_
