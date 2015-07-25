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
    coding->_content_hash_type = *NanAsciiString(self->Get(NanNew("content_hash_type")));
    coding->_cipher_type = *NanAsciiString(self->Get(NanNew("cipher_type")));
    coding->_block_hash_type = *NanAsciiString(self->Get(NanNew("block_hash_type")));
    NanReturnValue(self);
}

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
    Buf _content_hash;
    struct Block
    {
        Buf data;
        Buf hash;
    };
    std::vector<Block> _fragments;
public:
    explicit EncodeJob(
        ObjectCoding& coding,
        v8::Handle<v8::Object> object_coding_handle,
        v8::Handle<v8::Value> buf_handle,
        NanCallbackSharedPtr callback)
        : _coding(coding)
        , _callback(callback)
        , _chunk(node::Buffer::Data(buf_handle), node::Buffer::Length(buf_handle))
        , _fragments(3)
    {
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
        // _content_hash = Buf(32, 0);
        _content_hash = Crypto::digest(_chunk, _coding._content_hash_type.c_str());

        // convergent encryption - use _content_hash as encryption key
        // const Buf& key = _content_hash;
        Buf key(32);
        RAND_bytes(key.data(), key.length());
        // IV is just zeros since the key is unique then IV is not needed
        static Buf iv(64, 0);
        // RAND_bytes(iv.data(), iv.length());
        Buf encrypted = Crypto::encrypt(_chunk, key, iv, _coding._cipher_type.c_str());

        const int data_blocks = 2;
        int encrypted_len = encrypted.length();
        int block_len = encrypted_len / data_blocks;
        Buf block1(encrypted, 0, block_len);
        Buf block2(encrypted, block_len, block_len);
        Buf parity(block_len);
        for (int i=0; i<block_len; ++i) {
            parity[i] = block1[i] ^ block2[i];
        }
        _fragments[0].data = block1;
        _fragments[1].data = block2;
        _fragments[2].data = parity;

        for (size_t i=0; i<_fragments.size(); ++i) {
            _fragments[i].hash = Crypto::hmac(_fragments[i].data, key, _coding._block_hash_type.c_str());
        }
    }

    virtual void done() override
    {
        NanScope();
        v8::Local<v8::Object> obj(NanNew<v8::Object>());
        obj->Set(NanNew("content_hash"), NanNew(_content_hash.hex()));
        obj->Set(NanNew("length"), NanNew(_chunk.length()));
        v8::Local<v8::Array> fragments(NanNew<v8::Array>(_fragments.size()));
        for (size_t i=0; i<_fragments.size(); ++i) {
            Block& block = _fragments[i];
            v8::Local<v8::Object> frag(NanNew<v8::Object>());
            frag->Set(NanNew("data"), NanNewBufferHandle(block.data.cdata(),block.data.length()));
            frag->Set(NanNew("hash"), NanNew(block.hash.hex()));
            fragments->Set(i, frag);
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
    Buf _chunk;
    Buf _content_hash;
    struct Block
    {
        Buf data;
        Buf hash;
    };
    std::vector<Block> _fragments;
public:
    explicit DecodeJob(
        ObjectCoding& coding,
        v8::Handle<v8::Object> object_coding_handle,
        v8::Handle<v8::Value> buf_handle,
        NanCallbackSharedPtr callback)
        : _coding(coding)
        , _callback(callback)
        , _chunk(node::Buffer::Data(buf_handle), node::Buffer::Length(buf_handle))
        , _fragments(3)
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, object_coding_handle);
        _persistent->Set(1, buf_handle);
    }

    virtual ~DecodeJob()
    {
        NanDisposePersistent(_persistent);
    }

    virtual void run() override
    {
    }

    virtual void done() override
    {
        NanScope();
        v8::Local<v8::Object> obj(NanNew<v8::Object>());
        obj->Set(NanNew("content_hash"), NanNew(_content_hash.hex()));
        obj->Set(NanNew("length"), NanNew(_chunk.length()));
        v8::Local<v8::Array> fragments(NanNew<v8::Array>(_fragments.size()));
        for (size_t i=0; i<_fragments.size(); ++i) {
            Block& block = _fragments[i];
            v8::Local<v8::Object> frag(NanNew<v8::Object>());
            frag->Set(NanNew("data"), NanNewBufferHandle(block.data.cdata(),block.data.length()));
            frag->Set(NanNew("hash"), NanNew(block.hash.hex()));
            fragments->Set(i, frag);
        }
        obj->Set(NanNew("fragments"), fragments);
        v8::Local<v8::Value> argv[] = { NanUndefined(), obj };
        _callback->Call(2, argv);
        delete this;
    }

};


NAN_METHOD(ObjectCoding::encode)
{
    NanScope();
    if (!node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
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
    if (!node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("ObjectCoding::decode expected arguments function(buffer,callback)");
    }
    v8::Local<v8::Object> self = args.This();
    ObjectCoding& coding = *Unwrap<ObjectCoding>(self);
    ThreadPool& tpool = *Unwrap<ThreadPool>(self->Get(NanNew("tpool"))->ToObject());
    v8::Local<v8::Object> buffer = args[0]->ToObject();
    NanCallbackSharedPtr callback(new NanCallback(args[1].As<v8::Function>()));
    DecodeJob* job = new DecodeJob(coding, self, buffer, callback);
    tpool.submit(job);
    NanReturnUndefined();
}
