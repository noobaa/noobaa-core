#ifndef OBJECT_ENCODER_H_
#define OBJECT_ENCODER_H_

#include "common.h"
#include "dedup.h"
#include "rabin_fingerprint.h"
#include "tpool.h"

/**
 *
 * ObjectEncoder
 *
 * 1. compute cryptographic hash for dedup chunk lookup
 * 2. encrypt the chunk
 * 3. erasure code to create data blocks and parity blocks
 * 4. compute blocks hash for integrity
 *
 */

class ObjectEncoder : public node::ObjectWrap
{
public:
    static void setup(v8::Handle<v8::Object> exports);

private:
    explicit ObjectEncoder()
    {
    }

    virtual ~ObjectEncoder()
    {
    }

private:
    class Job;

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
};

#endif // OBJECT_ENCODER_H_
