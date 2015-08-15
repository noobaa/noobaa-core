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
    NAN_SET(target, name, func);
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
    c._data_frags = NAN_GET_INT(self, "data_frags");
    c._parity_frags = NAN_GET_INT(self, "parity_frags");
    c._lrc_frags = NAN_GET_INT(self, "lrc_frags");
    c._lrc_parity = NAN_GET_INT(self, "lrc_parity");
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
        auto persistent = NAN_NEW_OBJ();
        NAN_SET(persistent, 0, object_coding_handle);
        NAN_SET(persistent, 1, buf_handle);
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
        auto obj = NAN_NEW_OBJ();
        NAN_SET_INT(obj, "size", _chunk.length());
        NAN_SET_STR(obj, "digest_type", _coding._digest_type);
        NAN_SET_BUF_COPY(obj, "digest_buf", _digest);
        NAN_SET_STR(obj, "cipher_type", _coding._cipher_type);
        NAN_SET_BUF_COPY(obj, "cipher_key", _secret);
        NAN_SET_INT(obj, "data_frags", _coding._data_frags);
        NAN_SET_INT(obj, "lrc_frags", _coding._lrc_frags);
        auto frags = NAN_NEW_ARR(_frags.size());
        for (size_t i=0; i<_frags.size(); ++i) {
            Fragment& f = _frags[i];
            auto frag_obj = NAN_NEW_OBJ();
            NAN_SET_STR(frag_obj, "layer", f.layer);
            NAN_SET_INT(frag_obj, "layer_n", f.layer_n);
            NAN_SET_INT(frag_obj, "frag", f.frag);
            NAN_SET_STR(frag_obj, "digest_type", f.digest_type);
            NAN_SET_BUF_COPY(frag_obj, "digest_buf", f.digest_buf);
            NAN_SET_BUF_COPY(frag_obj, "block", f.block);
            NAN_SET(frags, i, frag_obj);
        }
        NAN_SET(obj, "frags", frags);
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
    std::deque<Buf> _bad_frags_digests;
    Buf _bad_chunk_digest;
public:
    explicit DecodeWorker(
        ObjectCoding& coding,
        v8::Handle<v8::Object> object_coding_handle,
        v8::Handle<v8::Object> chunk,
        NanCallbackSharedPtr callback)
        : _coding(coding)
        , _callback(callback)
    {
        auto persistent = NAN_NEW_OBJ();
        NAN_SET(persistent, 0, object_coding_handle);
        NAN_SET(persistent, 1, chunk);
        _persistent.Reset(persistent);

        // converting from v8 structures to native to be accessible during run()
        // which is called from a working thread, and v8 handles are not allowed
        // to be created/dereferenced/destroyed from other threads.

        _digest_type = NAN_GET_STR(chunk, "digest_type");
        _digest = NAN_GET_BUF(chunk, "digest_buf");
        _cipher_type = NAN_GET_STR(chunk, "cipher_type");
        _secret = NAN_GET_BUF(chunk, "cipher_key");
        _length = NAN_GET_INT(chunk, "size");
        _data_frags = NAN_GET_INT(chunk, "data_frags");
        auto frags = NAN_GET_ARR(chunk, "frags");
        _frags.resize(frags->Length());
        for (size_t i=0; i<_frags.size(); ++i) {
            Fragment& f = _frags[i];
            auto frag = NAN_GET_OBJ(frags, i);
            f.layer = NAN_GET_STR(frag, "layer");
            f.layer_n = NAN_GET_INT(frag, "layer_n");
            f.frag = NAN_GET_INT(frag, "frag");
            f.digest_type = NAN_GET_STR(frag, "digest_type");
            f.digest_buf = NAN_GET_BUF(frag, "digest_buf");
            f.block = NAN_GET_BUF(frag, "block");
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
                /*
                std::cout
                    << std::endl
                    << digest_buf.length()
                    << " hex " << digest_buf.hex()
                    << " base64 " << digest_buf.base64()
                    << std::endl
                    << f.digest_buf.length()
                    << " hex " << f.digest_buf.hex()
                    << " base64 " << f.digest_buf.base64()
                    << std::endl;
                digest_buf = Buf(digest_buf.base64(), Buf::BASE64);
                */
                if (!digest_buf.same(f.digest_buf)) {
                    _bad_frags_digests.resize(i+1);
                    _bad_frags_digests[i] = digest_buf;
                }
            }
        }
        if (!_bad_frags_digests.empty()) {
            return;
        }

        // REBUILD ERASURE CODE DATA FROM FRAGMENTS
        std::vector<Buf> data_bufs(_data_frags);
        for (size_t i=0; i<data_bufs.size(); ++i) {
            data_bufs[i] = _frags[i].block;
            // std::cout << DVAL(data_bufs[i].length()) << std::endl;
        }
        Buf encrypted(_length, data_bufs.begin(), data_bufs.end());

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
                _bad_chunk_digest = digest;
            }
        }
    }

    virtual void after_work() override
    {
        Nan::HandleScope scope;
        if (!_bad_frags_digests.empty()) {
            int len = _bad_frags_digests.size();
            auto err = NAN_ERR("FRAGS DIGEST MISMATCH");
            auto bad_frags_digests = NAN_NEW_ARR(len);
            NAN_SET(err, "bad_frags_digests", bad_frags_digests);
            for (int i=0; i<len; ++i) {
                Buf& digest = _bad_frags_digests[i];
                if (digest.length()) {
                    NAN_SET_BUF_COPY(bad_frags_digests, i, digest);
                }
            }
            v8::Local<v8::Value> argv[] = { err };
            _callback->Call(1, argv);
        } else if (_bad_chunk_digest.length()) {
            auto err = NAN_ERR("CHUNK DIGEST MISMATCH");
            NAN_SET_BUF_COPY(err, "bad_chunk_digest", _bad_chunk_digest);
            v8::Local<v8::Value> argv[] = { err };
            _callback->Call(1, argv);
        } else {
            auto persistent = Nan::New(_persistent);
            auto chunk = NAN_GET_OBJ(persistent, 1);
            NAN_SET_BUF_DETACH(chunk, "data", _chunk);
            v8::Local<v8::Value> argv[] = { Nan::Undefined(), chunk };
            _callback->Call(2, argv);
        }
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
