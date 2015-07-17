#ifndef INGEST_H_
#define INGEST_H_

#include "common.h"
#include "dedup.h"
#include "rabin_fingerprint.h"
#include "buzhash.h"
#include "tpool.h"

/**
 *
 * Ingest data stream addon for nodejs
 *
 * Performs variable length dedup,
 * then calculate cryptographic hash for dedup lookup,
 * if lookup is negative it will continue to do
 * encryption and finally erasure coding.
 *
 */

class Ingest : public node::ObjectWrap
{
public:
    static void setup(v8::Handle<v8::Object> exports);

private:
    explicit Ingest()
        : _chunker(_deduper)
    {
    }

    virtual ~Ingest()
    {
    }

private:
    class Job;
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
    Deduper::Chunker _chunker;

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
    static NAN_METHOD(flush);
};

#endif // INGEST_H_
