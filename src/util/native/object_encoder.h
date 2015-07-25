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
        : _content_hash_type("sha384")
        , _cipher_type("aes-256-gcm")
        , _block_hash_type("sha1")
    {
    }

    virtual ~ObjectEncoder()
    {
    }

private:
    class Job;
    std::string _content_hash_type;
    std::string _cipher_type;
    std::string _block_hash_type;

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
    static NAN_ACCESSOR_GETTER(content_hash_type_getter);
    static NAN_ACCESSOR_SETTER(content_hash_type_setter);
    static NAN_ACCESSOR_GETTER(cipher_type_getter);
    static NAN_ACCESSOR_SETTER(cipher_type_setter);
    static NAN_ACCESSOR_GETTER(block_hash_type_getter);
    static NAN_ACCESSOR_SETTER(block_hash_type_setter);
};

#endif // OBJECT_ENCODER_H_
