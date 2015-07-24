#ifndef OBJECT_DECODER_H_
#define OBJECT_DECODER_H_

#include "common.h"

/**
 *
 * ObjectDecoder
 *
 * Performs variable length dedup,
 * then calculate cryptographic hash for dedup lookup,
 * if lookup is negative it will continue to do
 * encryption and finally erasure coding.
 *
 */

class ObjectDecoder : public node::ObjectWrap
{
public:
    static void setup(v8::Handle<v8::Object> exports);

private:
    explicit ObjectDecoder()
    {
    }

    virtual ~ObjectDecoder()
    {
    }

private:
    class Job;

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
};

#endif // OBJECT_DECODER_H_
