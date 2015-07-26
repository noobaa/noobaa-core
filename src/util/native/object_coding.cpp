#include "object_coding.h"
#include "buf.h"
#include "crypto.h"

v8::Persistent<v8::Function> ObjectCoding::_ctor;

void
ObjectCoding::setup(v8::Handle<v8::Object> exports)
{
    auto name = "ObjectCoding";
    auto tpl(NanNew<v8::FunctionTemplate>(ObjectCoding::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "encode", ObjectCoding::encode);
    NODE_SET_PROTOTYPE_METHOD(tpl, "decode", ObjectCoding::decode);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(ObjectCoding::new_instance)
{
    NanScope();
    NAN_MAKE_CTOR_CALL(_ctor);
    v8::Local<v8::Object> self = args.This();
    v8::Local<v8::Object> options = args[0]->ToObject();
    ObjectCoding* coding = new ObjectCoding();
    coding->Wrap(self);
    NAN_COPY_OPTIONS_TO_WRAPPER(self, options);
    // TODO should we allow updating these fields?
    coding->_digest_type = *NanAsciiString(self->Get(NanNew("digest_type")));
    if (coding->_digest_type == "undefined") {
        coding->_digest_type = "";
    }
    coding->_cipher_type = *NanAsciiString(self->Get(NanNew("cipher_type")));
    if (coding->_cipher_type == "undefined") {
        coding->_cipher_type = "";
    }
    coding->_block_digest_type = *NanAsciiString(self->Get(NanNew("block_digest_type")));
    if (coding->_block_digest_type == "undefined") {
        coding->_block_digest_type = "";
    }
    coding->_data_fragments = self->Get(NanNew("data_fragments"))->Int32Value();
    coding->_parity_fragments = self->Get(NanNew("parity_fragments"))->Int32Value();
    // coding->_lrc_group_fragments = self->Get(NanNew("lrc_group_fragments"))->Int32Value();
    // coding->_lrc_parity_fragments = self->Get(NanNew("lrc_parity_fragments"))->Int32Value();
    std::cout << "ObjectCoding::new_instance"
              << " digest_type=" << coding->_digest_type
              << " cipher_type=" << coding->_cipher_type
              << " block_digest_type=" << coding->_block_digest_type
              << " data_fragments=" << coding->_data_fragments
              << " parity_fragments=" << coding->_parity_fragments
              << std::endl;
    NanReturnValue(self);
}

struct Fragment
{
    Buf block;
    Buf digest;
};

/**
 *
 *
 * EncodeJob
 *
 */
class ObjectCoding::EncodeJob : public ThreadPool::Job
{
private:
    ObjectCoding& _coding;
    v8::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
    Buf _chunk;
    Buf _digest;
    Buf _secret_key;
    std::vector<Fragment> _fragments;
public:
    explicit EncodeJob(
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
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, object_coding_handle);
        _persistent->Set(1, buf_handle);
    }

    virtual ~EncodeJob()
    {
        NanDisposePersistent(_persistent);
    }

    virtual void run() override
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
            // _secret_key = _digest;
            _secret_key = Buf(32);
            RAND_bytes(_secret_key.data(), _secret_key.length());
            // IV is just zeros since the key is unique then IV is not needed
            static Buf iv(64, 0);
            // RAND_bytes(iv.data(), iv.length());
            encrypted = Crypto::encrypt(_chunk, _coding._cipher_type.c_str(), _secret_key, iv);
        } else {
            encrypted = _chunk;
        }

        // BUILD FRAGMENTS OF ERASURE CODE
        const int encrypted_len = encrypted.length();
        const int data_frags = _coding._data_fragments;
        const int parity_frags = _coding._parity_fragments;
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
                uint8_t* source = _fragments[j].block.data();
                for (int k=0; k<block_len; ++k) {
                    target[k] ^= source[k];
                }
            }
            _fragments[i + data_frags].block = parity;
        }

        // COMPUTE BLOCKS HASH
        if (!_coding._block_digest_type.empty()) {
            for (size_t i=0; i<_fragments.size(); ++i) {
                _fragments[i].digest = Crypto::digest(_fragments[i].block, _coding._block_digest_type.c_str());
            }
        }
    }

    virtual void done() override
    {
        NanScope();
        v8::Local<v8::Object> obj(NanNew<v8::Object>());
        obj->Set(NanNew("digest_type"), NanNew(_coding._digest_type));
        obj->Set(NanNew("cipher_type"), NanNew(_coding._cipher_type));
        obj->Set(NanNew("block_digest_type"), NanNew(_coding._block_digest_type));
        obj->Set(NanNew("digest"), NanNew(_digest.hex()));
        obj->Set(NanNew("secret_key"), NanNew(_secret_key.hex()));
        obj->Set(NanNew("length"), NanNew(_chunk.length()));
        obj->Set(NanNew("data_fragments"), NanNew(_coding._data_fragments));
        obj->Set(NanNew("parity_fragments"), NanNew(_coding._parity_fragments));
        v8::Local<v8::Array> fragments(NanNew<v8::Array>(_fragments.size()));
        for (size_t i=0; i<_fragments.size(); ++i) {
            Fragment& frag = _fragments[i];
            v8::Local<v8::Object> frag_obj(NanNew<v8::Object>());
            frag_obj->Set(NanNew("block"), NanNewBufferHandle(frag.block.cdata(), frag.block.length()));
            frag_obj->Set(NanNew("digest"), NanNew(frag.digest.hex()));
            fragments->Set(i, frag_obj);
        }
        obj->Set(NanNew("fragments"), fragments);
        v8::Local<v8::Value> argv[] = { NanUndefined(), obj };
        _callback->Call(2, argv);
        delete this;
    }

};


/**
 *
 *
 * DecodeJob
 *
 */
class ObjectCoding::DecodeJob : public ThreadPool::Job
{
private:
    ObjectCoding& _coding;
    v8::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
    std::string _digest_type;
    std::string _cipher_type;
    std::string _block_digest_type;
    Buf _digest;
    Buf _secret_key;
    Buf _chunk;
    int _length;
    int _data_fragments;
    int _parity_fragments;
    std::vector<Fragment> _fragments;
public:
    explicit DecodeJob(
        ObjectCoding& coding,
        v8::Handle<v8::Object> object_coding_handle,
        v8::Handle<v8::Object> chunk,
        NanCallbackSharedPtr callback)
        : _coding(coding)
        , _callback(callback)
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, object_coding_handle);
        _persistent->Set(1, chunk);

        // converting from v8 structures to native to be accessible during run()
        // which is called from a working thread, and v8 handles are not allowed
        // to be created/dereferenced/destroyed from other threads.

        _digest_type = *NanAsciiString(chunk->Get(NanNew("digest_type")));
        _cipher_type = *NanAsciiString(chunk->Get(NanNew("cipher_type")));
        _block_digest_type = *NanAsciiString(chunk->Get(NanNew("block_digest_type")));
        _digest = Buf(*NanAsciiString(chunk->Get(NanNew("digest"))));
        _secret_key = Buf(*NanAsciiString(chunk->Get(NanNew("secret_key"))));
        _length = chunk->Get(NanNew("length"))->Int32Value();
        _data_fragments = chunk->Get(NanNew("data_fragments"))->Int32Value();
        _parity_fragments = chunk->Get(NanNew("parity_fragments"))->Int32Value();
        v8::Local<v8::Array> fragments = chunk->Get(NanNew("fragments")).As<v8::Array>();
        _fragments.resize(fragments->Length());
        for (size_t i=0; i<_fragments.size(); ++i) {
            v8::Local<v8::Object> frag = fragments->Get(i)->ToObject();
            v8::Local<v8::Object> block = frag->Get(NanNew("block"))->ToObject();
            _fragments[i].block = Buf(node::Buffer::Data(block), node::Buffer::Length(block));
            _fragments[i].digest = Buf(*NanAsciiString(frag->Get(NanNew("digest"))));
        }
    }

    virtual ~DecodeJob()
    {
        NanDisposePersistent(_persistent);
    }

    virtual void run() override
    {
        // VERIFY BLOCKS HASH
        if (!_block_digest_type.empty()) {
            for (size_t i=0; i<_fragments.size(); ++i) {
                Buf digest = Crypto::digest(_fragments[i].block, _block_digest_type.c_str());
                if (!digest.same(_fragments[i].digest)) {
                    PANIC("fragment " << i << " digest mismatch " << digest.hex() << " " << _fragments[i].digest.hex());
                }
            }
        }

        // REBUILD ERASURE CODE DATA FROM FRAGMENTS
        std::vector<Buf> data_blocks(_data_fragments);
        for (size_t i=0; i<data_blocks.size(); ++i) {
            data_blocks[i] = _fragments[i].block;
            std::cout << DVAL(data_blocks[i].length()) << std::endl;
        }
        const int encrypted_len = data_blocks[0].length() * _data_fragments;
        Buf encrypted(encrypted_len, data_blocks.begin(), data_blocks.end());

        // DECRYPT DATA
        if (!_cipher_type.empty()) {
            // IV is just zeros since the key is unique then IV is not needed
            static Buf iv(64, 0);
            _chunk = Crypto::decrypt(encrypted, _cipher_type.c_str(), _secret_key, iv);
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

    virtual void done() override
    {
        NanScope();
        v8::Local<v8::Object> chunk(_persistent->Get(1)->ToObject());
        chunk->Set(NanNew("data"), NanBufferUse(_chunk.cdata(), _chunk.length()));
        assert(_chunk.unique_alloc());
        _chunk.detach_alloc();
        v8::Handle<v8::Value> argv[] = { NanUndefined(), chunk };
        _callback->Call(2, argv);
        delete this;
    }

};


NAN_METHOD(ObjectCoding::encode)
{
    NanScope();
    if (!node::Buffer::HasInstance(args[0]) || !args[1]->IsFunction()) {
        return NanThrowError("ObjectCoding::encode expected arguments function(buffer,callback)");
    }
    v8::Local<v8::Object> self = args.This();
    ObjectCoding& coding = *Unwrap<ObjectCoding>(self);
    ThreadPool& tpool = *Unwrap<ThreadPool>(self->Get(NanNew("tpool"))->ToObject());
    v8::Local<v8::Object> buffer = args[0]->ToObject();
    NanCallbackSharedPtr callback(new NanCallback(args[1].As<v8::Function>()));
    EncodeJob* job = new EncodeJob(coding, self, buffer, callback);
    tpool.submit(job);
    NanReturnUndefined();
}

NAN_METHOD(ObjectCoding::decode)
{
    NanScope();
    if (!args[0]->IsObject() || !args[1]->IsFunction()) {
        return NanThrowError("ObjectCoding::decode expected arguments function(chunk,callback)");
    }
    v8::Local<v8::Object> self = args.This();
    ObjectCoding& coding = *Unwrap<ObjectCoding>(self);
    ThreadPool& tpool = *Unwrap<ThreadPool>(self->Get(NanNew("tpool"))->ToObject());
    v8::Local<v8::Object> chunk = args[0]->ToObject();
    NanCallbackSharedPtr callback(new NanCallback(args[1].As<v8::Function>()));
    DecodeJob* job = new DecodeJob(coding, self, chunk, callback);
    tpool.submit(job);
    NanReturnUndefined();
}
