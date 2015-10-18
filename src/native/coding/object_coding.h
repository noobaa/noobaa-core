#ifndef NOOBAA__OBJECT_CODING__H
#define NOOBAA__OBJECT_CODING__H

#include "../util/common.h"
#include "../util/rabin_fingerprint.h"
#include "../util/tpool.h"
#include "dedup.h"

namespace noobaa {

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

class ObjectCoding : public Nan::ObjectWrap
{
public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(encode);
    static NAN_METHOD(decode);

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
    std::string _compress_type;
    std::string _cipher_type;
    std::string _frag_digest_type;
    int _data_frags;
    int _parity_frags;
    int _lrc_frags;
    int _lrc_parity;
};

} // namespace noobaa

#endif // NOOBAA__OBJECT_CODING__H
