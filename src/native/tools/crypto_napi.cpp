/* Copyright (C) 2016 NooBaa */
#include <string.h>
#include <vector>
#include "../third_party/isa-l_crypto/include/md5_mb.h"
#include "../util/common.h"
#include "../util/endian.h"
#include "../util/napi.h"
#include "../util/worker.h"

namespace noobaa
{

struct MD5Wrap : public Napi::ObjectWrap<MD5Wrap>
{
    size_t _NWORDS = MD5_DIGEST_NWORDS;
    bool _WORDS_BE = false;
    void (*_INIT)(MD5_HASH_CTX_MGR*) = md5_ctx_mgr_init;
    MD5_HASH_CTX *(*_SUBMIT)(MD5_HASH_CTX_MGR*, MD5_HASH_CTX*, const void*, uint32_t, HASH_CTX_FLAG) = md5_ctx_mgr_submit;
    MD5_HASH_CTX *(*_FLUSH)(MD5_HASH_CTX_MGR*) = md5_ctx_mgr_flush;
    DECLARE_ALIGNED(MD5_HASH_CTX_MGR _mgr, 16);
    DECLARE_ALIGNED(MD5_HASH_CTX _ctx, 16);

    static Napi::FunctionReference constructor;
    static void init(Napi::Env env)
    {
        constructor = Napi::Persistent(DefineClass(
            env,
            "MD5",
            {
                InstanceMethod("update", &MD5Wrap::update),
                InstanceMethod("digest", &MD5Wrap::digest),
            }));
        constructor.SuppressDestruct();
    }
    MD5Wrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<MD5Wrap>(info)
    {
        hash_ctx_init(&_ctx);
        _INIT(&_mgr);
        submit_and_flush(0, 0, HASH_FIRST);
    }
    ~MD5Wrap()
    {
    }
    void submit_and_flush(const void* data, uint32_t size, HASH_CTX_FLAG flag)
    {
        _SUBMIT(&_mgr, &_ctx, data, size, flag);
        while (hash_ctx_processing(&_ctx)) {
            _FLUSH(&_mgr);
        }
    }
    Napi::Value update(const Napi::CallbackInfo& info);
    Napi::Value digest(const Napi::CallbackInfo& info);
};

Napi::FunctionReference MD5Wrap::constructor;

struct MD5Update : public ObjectWrapWorker<MD5Wrap>
{
    uint8_t* _buf;
    size_t _len;
    /**
     * @brief Create an MD5Update worker and capture the input buffer for the update.
     *
     * Binds the worker to the wrapped MD5 object and stores a pointer and length referencing the Buffer provided as the first argument.
     *
     * @param info N-API callback info; its first argument (info[0]) must be a Buffer<uint8_t> whose data pointer and length are stored for the update operation.
     */
    MD5Update(const Napi::CallbackInfo& info)
        : ObjectWrapWorker<MD5Wrap>(info)
        , _buf(0)
        , _len(0)
    {
        auto buf = info[0].As<Napi::Buffer<uint8_t>>();
        _buf = buf.Data();
        _len = buf.Length();
    }
    /**
     * @brief Applies the worker's buffer to the associated MD5 context.
     *
     * Submits the stored input bytes to the wrapped MD5 context as an update operation.
     */
    virtual void Execute()
    {
        _wrap->submit_and_flush(_buf, _len, HASH_UPDATE);
    }
};

struct MD5Digest : public ObjectWrapWorker<MD5Wrap>
{
    std::vector<uint32_t> _digest;
    /**
     * @brief Create an MD5Digest worker bound to the JavaScript callback context.
     *
     * @param info N-API callback information used to construct and bind the worker to the JS object.
     */
    MD5Digest(const Napi::CallbackInfo& info)
        : ObjectWrapWorker<MD5Wrap>(info)
    {
    }
    /**
     * @brief Finalizes the MD5 computation and populates the native digest vector.
     *
     * Ensures the digest vector has capacity for all digest words, finalizes the
     * underlying hash context, and fills _digest with the resulting 32-bit words
     * converted to host endianness according to _wrap->_WORDS_BE.
     */
    virtual void Execute()
    {
        _digest.reserve(_wrap->_NWORDS);
        _wrap->submit_and_flush(0, 0, HASH_LAST);
        for (size_t i = 0; i < _wrap->_NWORDS; i++) {
            _digest[i] = _wrap->_WORDS_BE ? be32toh(hash_ctx_digest(&_wrap->_ctx)[i]) : le32toh(hash_ctx_digest(&_wrap->_ctx)[i]);
        }
    }
    /**
     * @brief Resolve the worker's promise with the computed MD5 digest as a Node Buffer.
     *
     * Resolves the internal promise with a Napi::Buffer<uint32_t> that copies the digest words
     * stored in `_digest`. The buffer contains `_wrap->_NWORDS` 32-bit words representing the MD5 digest.
     */
    virtual void OnOK()
    {
        Napi::Env env = Env();
        _promise.Resolve(Napi::Buffer<uint32_t>::Copy(env, _digest.data(), _wrap->_NWORDS));
    }
};

/**
 * @brief Starts an MD5 update operation using the provided callback arguments.
 *
 * Initiates an asynchronous MD5Update worker bound to this MD5Wrap instance which processes the input buffer supplied in the JavaScript call.
 *
 * @returns Napi::Value JavaScript value produced by the MD5Update worker.
 */
Napi::Value
MD5Wrap::update(const Napi::CallbackInfo& info)
{
    return await_worker<MD5Update>(info);
}

/**
 * @brief Finalizes the MD5 computation and obtains the resulting digest.
 *
 * @returns A JavaScript Buffer containing the MD5 digest as 32-bit words converted to host byte order.
 */
Napi::Value
MD5Wrap::digest(const Napi::CallbackInfo& info)
{
    return await_worker<MD5Digest>(info);
}

/**
 * @brief Registers the crypto namespace on the module exports and exposes the MD5Async class.
 *
 * Initializes the MD5Wrap class constructor and attaches an object named "crypto" to the provided
 * exports containing the "MD5Async" constructor for asynchronous MD5 hashing.
 *
 * @param env The N-API environment for the current addon initialization.
 * @param exports The addon exports object to which the "crypto" property will be attached.
 */
void
crypto_napi(Napi::Env env, Napi::Object exports)
{
    auto exports_crypto_async = Napi::Object::New(env);

    MD5Wrap::init(env);
    exports_crypto_async["MD5Async"] = MD5Wrap::constructor.Value();

    exports["crypto"] = exports_crypto_async;
}

} // namespace noobaa