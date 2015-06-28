#ifndef INGEST_H_
#define INGEST_H_

#include "common.h"
#include "dedup.h"
#include "rabin_fingerprint.h"

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

class Ingest_v1 : public node::ObjectWrap
{
public:
    static void setup(v8::Handle<v8::Object> exports);
    class Config;

private:
    explicit Ingest_v1(NanCallbackRef callback)
        : _deduper(_deduper_conf, _hasher_conf)
        , _callback(callback)
    {
    }

    ~Ingest_v1()
    {
    }

    void purge_chunks();

private:
    typedef RabinFingerprint<uint32_t> Hasher;
    typedef Dedup<Hasher> Deduper;
    Deduper _deduper;
    NanCallbackRef _callback;
    static Hasher::Config _hasher_conf;
    static Deduper::Config _deduper_conf;
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
    static NAN_METHOD(flush);
};

class Ingest_v1::Config {
public:
    explicit Config()
    {
    }
};


#endif // INGEST_H_
