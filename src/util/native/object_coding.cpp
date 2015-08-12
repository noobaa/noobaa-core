#include "object_coding.h"
#include "buf.h"
#include "crypto.h"

Nan::Persistent<v8::Function> ObjectCoding::_ctor;

NAN_MODULE_INIT(ObjectCoding::setup)
{
    auto name = "ObjectCoding";
    auto tpl = Nan::New<v8::FunctionTemplate>(ObjectCoding::new_instance);
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tpl, "encode", ObjectCoding::encode);
    Nan::SetPrototypeMethod(tpl, "decode", ObjectCoding::decode);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(tpl->GetFunction());
    Nan::Set(target, NAN_STR(name), func);
}

NAN_METHOD(ObjectCoding::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    v8::Local<v8::Object> self = info.This();
    v8::Local<v8::Object> options = info[0]->ToObject();
    ObjectCoding* coding = new ObjectCoding();
    coding->Wrap(self);
    NAN_COPY_OPTIONS_TO_WRAPPER(self, options);
    // TODO should we allow updating these fields?
    ObjectCoding& c = *coding;
    c._digest_type = NAN_GET_STR(self, "digest_type");
    if (c._digest_type == "undefined") {
        c._digest_type = "";
    }
    c._cipher_type = NAN_GET_STR(self, "cipher_type");
    if (c._cipher_type == "undefined") {
        c._cipher_type = "";
    }
    c._frag_digest_type = NAN_GET_STR(self, "frag_digest_type");
    if (c._frag_digest_type == "undefined") {
        c._frag_digest_type = "";
    }
    c._data_frags = NAN_GET(self, "data_frags")->Int32Value();
    c._parity_frags = NAN_GET(self, "parity_frags")->Int32Value();
    c._lrc_frags = NAN_GET(self, "lrc_frags")->Int32Value();
    c._lrc_parity = NAN_GET(self, "lrc_parity")->Int32Value();
    std::cout << "ObjectCoding::new_instance "
              << DVAL(c._digest_type)
              << DVAL(c._cipher_type)
              << DVAL(c._frag_digest_type)
              << DVAL(c._data_frags)
              << DVAL(c._parity_frags)
              << DVAL(c._lrc_frags)
              << DVAL(c._lrc_parity)
              << std::endl;
    ASSERT(c._data_frags > 0, DVAL(c._data_frags));
    info.GetReturnValue().Set(self);
}

struct Fragment
{
    Buf block;
    std::string layer;
    int layer_n;
    int frag;
    std::string digest_type;
    Buf digest_buf;
};

/**
 *
 *
 * EncodeWorker
 *
 */
class ObjectCoding::EncodeWorker : public ThreadPool::Worker
{
private:
    ObjectCoding& _coding;
    Nan::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
    Buf _chunk;
    Buf _digest;
    Buf _secret;
    std::deque<Fragment> _frags;
public:
    explicit EncodeWorker(
        ObjectCoding& coding,
        v8::Handle<v8::Object> object_coding_handle,
        v8::Handle<v8::Value> buf_handle,
        NanCallbackSharedPtr callback)
        : _coding(coding)
        , _callback(callback)
        , _chunk(node::Buffer::Data(buf_handle), node::Buffer::Length(buf_handle))
    {
        // create a persistent object with references to the handles
        // that we need to keep alive during this job
        auto persistent = Nan::New<v8::Object>();
        Nan::Set(persistent, 0, object_coding_handle);
        Nan::Set(persistent, 1, buf_handle);
        _persistent.Reset(persistent);
    }

    virtual ~EncodeWorker()
    {
        _persistent.Reset();
    }

    virtual void work() override
    {
        // COMPUTE CONTENT VERIFIER
        if (!_coding._digest_type.empty()) {
            // _digest = Buf(32, 0);
            _digest = Crypto::digest(_chunk, _coding._digest_type.c_str());
        }

        // COMPUTE ENCRYPTED BUFFER
        Buf encrypted;
        if (!_coding._cipher_type.empty()) {
            // convergent encryption - use _digest as secret key
            // _secret = _digest;
            _secret = Buf(32);
            RAND_bytes(_secret.data(), _secret.length());
            // IV is just zeros since the key is unique then IV is not needed
            static Buf iv(64, 0);
            // RAND_bytes(iv.data(), iv.length());
            encrypted = Crypto::encrypt(_chunk, _coding._cipher_type.c_str(), _secret, iv);
        } else {
            encrypted = _chunk;
        }

        // BUILD FRAGMENTS OF ERASURE CODE
        const int encrypted_len = encrypted.length();
        const int data_frags = _coding._data_frags;
        const int parity_frags = _coding._parity_frags;
        const int lrc_frags = _coding._lrc_frags;
        const int lrc_parity = _coding._lrc_parity;
        const int lrc_groups = (lrc_frags==0) ? 0 : (data_frags + parity_frags) / lrc_frags;
        const int lrc_total_frags = lrc_groups * lrc_parity;
        const int block_len = (encrypted_len + data_frags - 1) / data_frags;
        _frags.resize(data_frags + parity_frags + lrc_total_frags);
        for (int i=0; i<data_frags; ++i) {
            Fragment& f = _frags[i];
            f.block = Buf(encrypted, i*block_len, block_len);
            f.layer = "D";
            f.layer_n = 0;
            f.frag = i;
        }
        // TODO this is not erasure code, it's just XOR of all blocks to test performance
        for (int i=0; i<parity_frags; ++i) {
            Buf parity(block_len, 0);
            uint8_t* target = parity.data();
            for (int j=0; j<data_frags; ++j) {
                const uint8_t* source = _frags[j].block.data();
                for (int k=0; k<block_len; ++k) {
                    target[k] ^= source[k];
                }
            }
            Fragment& f = _frags[data_frags + i];
            f.block = parity;
            f.layer = "RS";
            f.layer_n = 0;
            f.frag = i;
        }
        for (int l=0; l<lrc_groups; ++l) {
            for (int i=0; i<lrc_parity; ++i) {
                Buf parity(block_len, 0);
                uint8_t* target = parity.data();
                for (int j=0; j<lrc_frags; ++j) {
                    const uint8_t* source = _frags[(l*lrc_frags) + j].block.data();
                    for (int k=0; k<block_len; ++k) {
                        target[k] ^= source[k];
                    }
                }
                Fragment& f = _frags[data_frags + parity_frags + (l*lrc_parity) + i];
                f.block = parity;
                f.layer = "LRC";
                f.layer_n = l;
                f.frag = i;
            }
        }

        // COMPUTE BLOCKS HASH
        if (!_coding._frag_digest_type.empty()) {
            for (size_t i=0; i<_frags.size(); ++i) {
                Fragment& f = _frags[i];
                f.digest_type = _coding._frag_digest_type;
                f.digest_buf = Crypto::digest(f.block, f.digest_type.c_str());
            }
        }
    }

    virtual void after_work() override
    {
        Nan::HandleScope scope;
        v8::Local<v8::Object> obj(Nan::New<v8::Object>());
        Nan::Set(obj, NAN_STR("length"), Nan::New(_chunk.length()));
        Nan::Set(obj, NAN_STR("digest_type"), NAN_STR(_coding._digest_type));
        Nan::Set(obj, NAN_STR("digest_buf"), Nan::CopyBuffer(
                     _digest.cdata(), _digest.length()).ToLocalChecked());
        Nan::Set(obj, NAN_STR("cipher_type"), NAN_STR(_coding._cipher_type));
        Nan::Set(obj, NAN_STR("cipher_key"), Nan::CopyBuffer(
                     _secret.cdata(), _secret.length()).ToLocalChecked());
        Nan::Set(obj, NAN_STR("data_frags"), Nan::New(_coding._data_frags));
        Nan::Set(obj, NAN_STR("lrc_frags"), Nan::New(_coding._lrc_frags));
        v8::Local<v8::Array> frags(Nan::New<v8::Array>(_frags.size()));
        for (size_t i=0; i<_frags.size(); ++i) {
            Fragment& f = _frags[i];
            v8::Local<v8::Object> frag_obj(Nan::New<v8::Object>());
            Nan::Set(frag_obj, NAN_STR("layer"), NAN_STR(f.layer));
            Nan::Set(frag_obj, NAN_STR("layer_n"), Nan::New(f.layer_n));
            Nan::Set(frag_obj, NAN_STR("frag"), Nan::New(f.frag));
            Nan::Set(frag_obj, NAN_STR("digest_type"), NAN_STR(f.digest_type));
            Nan::Set(frag_obj, NAN_STR("digest_buf"), Nan::CopyBuffer(
                         f.digest_buf.cdata(), f.digest_buf.length()).ToLocalChecked());
            Nan::Set(frag_obj, NAN_STR("block"), Nan::CopyBuffer(
                         f.block.cdata(), f.block.length()).ToLocalChecked());
            frags->Set(i, frag_obj);
        }
        Nan::Set(obj, NAN_STR("frags"), frags);
        v8::Local<v8::Value> argv[] = { Nan::Undefined(), obj };
        _callback->Call(2, argv);
        delete this;
    }

};


/**
 *
 *
 * DecodeWorker
 *
 */
class ObjectCoding::DecodeWorker : public ThreadPool::Worker
{
private:
    ObjectCoding& _coding;
    Nan::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
    std::string _digest_type;
    std::string _cipher_type;
    Buf _digest;
    Buf _secret;
    Buf _chunk;
    int _length;
    int _data_frags;
    std::vector<Fragment> _frags;
public:
    explicit DecodeWorker(
        ObjectCoding& coding,
        v8::Handle<v8::Object> object_coding_handle,
        v8::Handle<v8::Object> chunk,
        NanCallbackSharedPtr callback)
        : _coding(coding)
        , _callback(callback)
    {
        auto persistent = Nan::New<v8::Object>();
        Nan::Set(persistent, 0, object_coding_handle);
        Nan::Set(persistent, 1, chunk);
        _persistent.Reset(persistent);

        // converting from v8 structures to native to be accessible during run()
        // which is called from a working thread, and v8 handles are not allowed
        // to be created/dereferenced/destroyed from other threads.

        _digest_type = NAN_GET_STR(chunk, "digest_type");
        _digest = Buf(NAN_GET_STR(chunk, "digest_buf"));
        _cipher_type = NAN_GET_STR(chunk, "cipher_type");
        _secret = Buf(NAN_GET_STR(chunk, "secret"));
        _length = chunk->Get(NAN_STR("length"))->Int32Value();
        _data_frags = chunk->Get(NAN_STR("data_frags"))->Int32Value();
        v8::Local<v8::Array> frags = chunk->Get(NAN_STR("frags")).As<v8::Array>();
        _frags.resize(frags->Length());
        for (size_t i=0; i<_frags.size(); ++i) {
            Fragment& f = _frags[i];
            v8::Local<v8::Object> frag = frags->Get(i)->ToObject();
            v8::Local<v8::Object> block = frag->Get(NAN_STR("block"))->ToObject();
            f.layer = NAN_GET_STR(frag, "layer");
            f.layer_n = frag->Get(NAN_STR("layer_n"))->Int32Value();
            f.frag = frag->Get(NAN_STR("frag"))->Int32Value();
            f.digest_type = NAN_GET_STR(frag, "digest_type");
            f.digest_buf = Buf(NAN_GET_STR(frag, "digest_buf"));
            f.block = Buf(node::Buffer::Data(block), node::Buffer::Length(block));
        }
    }

    virtual ~DecodeWorker()
    {
        _persistent.Reset();
    }

    virtual void work() override
    {
        // VERIFY BLOCKS HASH
        for (size_t i=0; i<_frags.size(); ++i) {
            Fragment& f = _frags[i];
            if (!f.digest_type.empty()) {
                Buf digest_buf = Crypto::digest(f.block, f.digest_type.c_str());
                if (!digest_buf.same(f.digest_buf)) {
                    PANIC("fragment " << i << " digest mismatch " << digest_buf.hex() << " " << f.digest_buf.hex());
                }
            }
        }

        // REBUILD ERASURE CODE DATA FROM FRAGMENTS
        std::vector<Buf> data_blocks(_data_frags);
        for (size_t i=0; i<data_blocks.size(); ++i) {
            data_blocks[i] = _frags[i].block;
            // std::cout << DVAL(data_blocks[i].length()) << std::endl;
        }
        const int encrypted_len = data_blocks[0].length() * _data_frags;
        Buf encrypted(encrypted_len, data_blocks.begin(), data_blocks.end());

        // DECRYPT DATA
        if (!_cipher_type.empty()) {
            // IV is just zeros since the key is unique then IV is not needed
            static Buf iv(64, 0);
            _chunk = Crypto::decrypt(encrypted, _cipher_type.c_str(), _secret, iv);
        } else {
            _chunk = encrypted;
        }

        // VERIFY CONTENT HASH
        if (!_digest_type.empty()) {
            Buf digest = Crypto::digest(_chunk, _digest_type.c_str());
            if (!digest.same(_digest)) {
                PANIC("digest mismatch " << digest.hex() << " " << _digest.hex());
            }
        }
    }

    virtual void after_work() override
    {
        Nan::HandleScope scope;
        v8::Local<v8::Object> persistent = Nan::New(_persistent);
        v8::Local<v8::Object> chunk = Nan::To<v8::Object>(Nan::Get(persistent, 1).ToLocalChecked()).ToLocalChecked();
        assert(_chunk.unique_alloc());
        Nan::Set(chunk, NAN_STR("data"), Nan::NewBuffer(_chunk.cdata(), _chunk.length()).ToLocalChecked());
        _chunk.detach_alloc();
        v8::Local<v8::Value> argv[] = { Nan::Undefined(), chunk };
        _callback->Call(2, argv);
        delete this;
    }

};


NAN_METHOD(ObjectCoding::encode)
{
    if (!node::Buffer::HasInstance(info[0]) || !info[1]->IsFunction()) {
        return Nan::ThrowError("ObjectCoding::encode expected arguments function(buffer,callback)");
    }
    v8::Local<v8::Object> self = info.This();
    ObjectCoding& coding = *NAN_UNWRAP_THIS(ObjectCoding);
    ThreadPool& tpool = *NAN_GET_UNWRAP(ThreadPool, self, "tpool");
    v8::Local<v8::Object> buffer = Nan::To<v8::Object>(info[0]).ToLocalChecked();
    NanCallbackSharedPtr callback(new Nan::Callback(info[1].As<v8::Function>()));
    EncodeWorker* worker = new EncodeWorker(coding, self, buffer, callback);
    tpool.submit(worker);
    NAN_RETURN(Nan::Undefined());
}

NAN_METHOD(ObjectCoding::decode)
{
    if (!info[0]->IsObject() || !info[1]->IsFunction()) {
        return Nan::ThrowError("ObjectCoding::decode expected arguments function(chunk,callback)");
    }
    v8::Local<v8::Object> self = info.This();
    ObjectCoding& coding = *NAN_UNWRAP_THIS(ObjectCoding);
    ThreadPool& tpool = *NAN_GET_UNWRAP(ThreadPool, self, "tpool");
    v8::Local<v8::Object> chunk = Nan::To<v8::Object>(info[0]).ToLocalChecked();
    NanCallbackSharedPtr callback(new Nan::Callback(info[1].As<v8::Function>()));
    DecodeWorker* worker = new DecodeWorker(coding, self, chunk, callback);
    tpool.submit(worker);
    NAN_RETURN(Nan::Undefined());
}
