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
    MD5Update(const Napi::CallbackInfo& info)
        : ObjectWrapWorker<MD5Wrap>(info)
        , _buf(0)
        , _len(0)
    {
        auto buf = info[0].As<Napi::Buffer<uint8_t>>();
        _buf = buf.Data();
        _len = buf.Length();
    }
    virtual void Execute()
    {
        _wrap->submit_and_flush(_buf, _len, HASH_UPDATE);
    }
};

struct MD5Digest : public ObjectWrapWorker<MD5Wrap>
{
    std::vector<uint32_t> _digest;
    MD5Digest(const Napi::CallbackInfo& info)
        : ObjectWrapWorker<MD5Wrap>(info)
    {
    }
    virtual void Execute()
    {
        _digest.reserve(_wrap->_NWORDS);
        _wrap->submit_and_flush(0, 0, HASH_LAST);
        for (size_t i = 0; i < _wrap->_NWORDS; i++) {
            _digest[i] = _wrap->_WORDS_BE ? be32toh(hash_ctx_digest(&_wrap->_ctx)[i]) : le32toh(hash_ctx_digest(&_wrap->_ctx)[i]);
        }
    }
    virtual void OnOK()
    {
        Napi::Env env = Env();
        _promise.Resolve(Napi::Buffer<uint32_t>::Copy(env, _digest.data(), _wrap->_NWORDS));
    }
};

Napi::Value
MD5Wrap::update(const Napi::CallbackInfo& info)
{
    return await_worker<MD5Update>(info);
}

Napi::Value
MD5Wrap::digest(const Napi::CallbackInfo& info)
{
    return await_worker<MD5Digest>(info);
}

void
crypto_napi(Napi::Env env, Napi::Object exports)
{
    auto exports_crypto_async = Napi::Object::New(env);

    MD5Wrap::init(env);
    exports_crypto_async["MD5Async"] = MD5Wrap::constructor.Value();

    exports["crypto"] = exports_crypto_async;
}

} // namespace noobaa
