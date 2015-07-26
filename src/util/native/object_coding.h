#ifndef OBJECT_CODING_H_
#define OBJECT_CODING_H_

#include "common.h"
#include "dedup.h"
#include "rabin_fingerprint.h"
#include "tpool.h"

/**
 *
 * ObjectCoding
 *
 * 1. compute cryptographic hash for dedup chunk lookup
 * 2. encrypt the chunk
 * 3. erasure code to create data blocks and parity blocks
 * 4. compute blocks hash for integrity
 *
 */

class ObjectCoding : public node::ObjectWrap
{
public:
    static void setup(v8::Handle<v8::Object> exports);

private:
    explicit ObjectCoding()
    {
    }

    virtual ~ObjectCoding()
    {
    }

private:
    class EncodeWorker;
    class DecodeWorker;
    std::string _digest_type;
    std::string _cipher_type;
    std::string _block_digest_type;
    int _data_fragments;
    int _parity_fragments;
    // int _lrc_group_fragments;
    // int _lrc_parity_fragments;

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(encode);
    static NAN_METHOD(decode);
};

#endif // OBJECT_CODING_H_
