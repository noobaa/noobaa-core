#ifndef INGEST_H_
#define INGEST_H_

#include "common.h"
#include "dedup.h"
#include "rabin_fingerprint.h"
#include "buzhash.h"

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
    explicit Ingest(NanCallbackRef callback)
        : _chunker(_deduper)
        , _callback(callback)
    {
    }

    ~Ingest()
    {
    }

    void purge_chunks();

private:
    // typedef BuzHash<uint32_t> BuzHasher;
    // typedef Dedup<BuzHasher> Deduper;
    // static BuzHasher _buz_hasher;
    typedef RabinFingerprint<uint32_t> RabinHasher;
    typedef Dedup<RabinHasher> Deduper;
    static RabinHasher _rabin_hasher;
    static Deduper _deduper;
    Deduper::Chunker _chunker;
    NanCallbackRef _callback;
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
    static NAN_METHOD(flush);
};

#endif // INGEST_H_
