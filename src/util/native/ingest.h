#ifndef INGEST_H_
#define INGEST_H_

#include "common.h"
#include "dedup.h"
#include "rabin.h"

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

private:
    explicit Ingest_v1() : _deduper(_deduper_conf, _hasher_conf) {}
    ~Ingest_v1() {}

private:
    typedef Rabin<uint32_t> Hasher;
    typedef Dedup<Hasher> Deduper;
    Deduper _deduper;
    static Hasher::Config _hasher_conf;
    static Deduper::Config _deduper_conf;
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
    static NAN_METHOD(flush);
};

#endif // INGEST_H_
