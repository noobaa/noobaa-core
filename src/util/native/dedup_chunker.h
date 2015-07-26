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

class DedupChunker : public node::ObjectWrap
{
public:
    static void setup(v8::Handle<v8::Object> exports);

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
    static const int WINDOW_LEN = 64;
    static const int MIN_CHUNK = 3 * 128 * 1024;
    static const int MAX_CHUNK = 6 * 128 * 1024;
    static const int AVG_CHUNK_BITS = 18;
    static const T AVG_CHUNK_VAL = 0x07071070;
    static GF _gf;
    static RabinHasher _rabin_hasher;
    static Deduper _deduper;
    Deduper::Window _dedup_window;
    std::list<Buf> _chunk_slices;
    int _chunk_len;

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
    static NAN_METHOD(flush);
};

#endif // DEDUP_CHUNKER_H_
