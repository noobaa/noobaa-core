#ifndef READ_PROCESSOR_H_
#define READ_PROCESSOR_H_

#include "common.h"

/**
 *
 * ReadProcessor
 *
 * Performs variable length dedup,
 * then calculate cryptographic hash for dedup lookup,
 * if lookup is negative it will continue to do
 * encryption and finally erasure coding.
 *
 */

class ReadProcessor : public node::ObjectWrap
{
public:
    static void setup(v8::Handle<v8::Object> exports);

private:
    explicit ReadProcessor()
    {
    }

    virtual ~ReadProcessor()
    {
    }

private:
    class Job;

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
    static NAN_METHOD(flush);
};

#endif // READ_PROCESSOR_H_
