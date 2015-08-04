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
    coding->_digest_type = NAN_GET_STR(self, "digest_type");
    if (coding->_digest_type == "undefined") {
        coding->_digest_type = "";
    }
    coding->_cipher_type = NAN_GET_STR(self, "cipher_type");
    if (coding->_cipher_type == "undefined") {
        coding->_cipher_type = "";
    }
    coding->_frag_digest_type = NAN_GET_STR(self, "frag_digest_type");
    if (coding->_frag_digest_type == "undefined") {
        coding->_frag_digest_type = "";
    }
    coding->_data_frags = NAN_GET(self, "data_frags")->Int32Value();
    coding->_parity_frags = NAN_GET(self, "parity_frags")->Int32Value();
    // coding->_lrc_group_fragments = self->Get(NAN_STR("lrc_group_fragments"))->Int32Value();
    // coding->_lrc_parity_fragments = self->Get(NAN_STR("lrc_parity_fragments"))->Int32Value();
    std::cout << "ObjectCoding::new_instance"
              << " digest_type=" << coding->_digest_type
              << " cipher_type=" << coding->_cipher_type
              << " frag_digest_type=" << coding->_frag_digest_type
              << " data_frags=" << coding->_data_frags
              << " parity_frags=" << coding->_parity_frags
              << std::endl;
    info.GetReturnValue().Set(self);
}

struct Fragment
{
    Buf block;
    Buf digest;
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
    std::vector<Fragment> _fragments;
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
        const int block_len = (encrypted_len + data_frags - 1) / data_frags;
        _fragments.resize(data_frags + parity_frags);
        for (int i=0; i<data_frags; ++i) {
            _fragments[i].block = Buf(encrypted, i*block_len, block_len);
        }
        // TODO this is not erasure code, it's just XOR of all blocks to test performance
        for (int i=0; i<parity_frags; ++i) {
            Buf parity(block_len, 0);
            uint8_t* target = parity.data();
            for (int j=0; j<data_frags; ++j) {
                const uint8_t* source = _fragments[j].block.data();
                for (int k=0; k<block_len; ++k) {
                    target[k] ^= source[k];
                }
            }
            _fragments[i + data_frags].block = parity;
        }

        // COMPUTE BLOCKS HASH
        if (!_coding._frag_digest_type.empty()) {
            for (size_t i=0; i<_fragments.size(); ++i) {
                _fragments[i].digest = Crypto::digest(_fragments[i].block, _coding._frag_digest_type.c_str());
            }
        }
    }

    virtual void after_work() override
    {
        Nan::HandleScope scope;
        v8::Local<v8::String> frag_digest_type = NAN_STR(_coding._frag_digest_type);
        v8::Local<v8::Object> obj(Nan::New<v8::Object>());
        Nan::Set(obj, NAN_STR("digest_type"), NAN_STR(_coding._digest_type));
        Nan::Set(obj, NAN_STR("cipher_type"), NAN_STR(_coding._cipher_type));
        Nan::Set(obj, NAN_STR("digest"), NAN_STR(_digest.hex()));
        Nan::Set(obj, NAN_STR("secret"), NAN_STR(_secret.hex()));
        Nan::Set(obj, NAN_STR("length"), Nan::New(_chunk.length()));
        // fragments rols is based on the array index
        // indexes < data_frags represent data blocks.
        // indexes >= data_frags represent parity blocks.
        // TODO need to update to represent LRC fragments
        v8::Local<v8::Array> fragments(Nan::New<v8::Array>(_fragments.size()));
        Nan::Set(obj, NAN_STR("fragments"), fragments);
        Nan::Set(obj, NAN_STR("data_frags"), Nan::New(_coding._data_frags));
        for (size_t i=0; i<_fragments.size(); ++i) {
            Fragment& frag = _fragments[i];
            v8::Local<v8::Object> frag_obj(Nan::New<v8::Object>());
            Nan::Set(frag_obj, NAN_STR("block"), Nan::CopyBuffer(frag.block.cdata(), frag.block.length()).ToLocalChecked());
            Nan::Set(frag_obj, NAN_STR("digest_type"), frag_digest_type);
            Nan::Set(frag_obj, NAN_STR("digest_val"), NAN_STR(frag.digest.hex()));
            fragments->Set(i, frag_obj);
        }
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
    std::string _frag_digest_type;
    Buf _digest;
    Buf _secret;
    Buf _chunk;
    int _length;
    int _data_frags;
    std::vector<Fragment> _fragments;
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
        _cipher_type = NAN_GET_STR(chunk, "cipher_type");
        _frag_digest_type = NAN_GET_STR(chunk, "frag_digest_type");
        _digest = Buf(NAN_GET_STR(chunk, "digest"));
        _secret = Buf(NAN_GET_STR(chunk, "secret"));
        _length = chunk->Get(NAN_STR("length"))->Int32Value();
        _data_frags = chunk->Get(NAN_STR("data_frags"))->Int32Value();
        v8::Local<v8::Array> fragments = chunk->Get(NAN_STR("fragments")).As<v8::Array>();
        _fragments.resize(fragments->Length());
        for (size_t i=0; i<_fragments.size(); ++i) {
            v8::Local<v8::Object> frag = fragments->Get(i)->ToObject();
            v8::Local<v8::Object> block = frag->Get(NAN_STR("block"))->ToObject();
            _fragments[i].block = Buf(node::Buffer::Data(block), node::Buffer::Length(block));
            _fragments[i].digest = Buf(NAN_GET_STR(frag, "digest"));
        }
    }

    virtual ~DecodeWorker()
    {
        _persistent.Reset();
    }

    virtual void work() override
    {
        // VERIFY BLOCKS HASH
        if (!_frag_digest_type.empty()) {
            for (size_t i=0; i<_fragments.size(); ++i) {
                if (!_fragments[i].digest.length()) {
                    Buf digest = Crypto::digest(_fragments[i].block, _frag_digest_type.c_str());
                    if (!digest.same(_fragments[i].digest)) {
                        PANIC("fragment " << i << " digest mismatch " << digest.hex() << " " << _fragments[i].digest.hex());
                    }
                }
            }
        }

        // REBUILD ERASURE CODE DATA FROM FRAGMENTS
        std::vector<Buf> data_blocks(_data_frags);
        for (size_t i=0; i<data_blocks.size(); ++i) {
            data_blocks[i] = _fragments[i].block;
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
