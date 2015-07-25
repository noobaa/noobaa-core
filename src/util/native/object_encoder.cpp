#include "object_encoder.h"
#include "buf.h"
#include "crypto.h"

v8::Persistent<v8::Function> ObjectEncoder::_ctor;

void
ObjectEncoder::setup(v8::Handle<v8::Object> exports)
{
    auto name = "ObjectEncoder";
    auto tpl(NanNew<v8::FunctionTemplate>(ObjectEncoder::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", ObjectEncoder::push);
    tpl->InstanceTemplate()->SetAccessor(NanNew("content_hash_type"),
                                         &content_hash_type_getter, &content_hash_type_setter);
    tpl->InstanceTemplate()->SetAccessor(NanNew("cipher_type"),
                                         &cipher_type_getter, &cipher_type_setter);
    tpl->InstanceTemplate()->SetAccessor(NanNew("block_hash_type"),
                                         &block_hash_type_getter, &block_hash_type_setter);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(ObjectEncoder::new_instance)
{
    NanScope();
    if (!args.IsConstructCall()) {
        // Invoked as plain function call, turn into construct 'new' call.
        NanReturnValue(_ctor->NewInstance());
    } else {
        ObjectEncoder* obj = new ObjectEncoder();
        obj->Wrap(args.This());
        
        args.This()->Set(NanNew("tpool"), args[0]);
        args.This()->Set(NanNew("tpool"), args[0]);
        args.This()->Set(NanNew("tpool"), args[0]);
        NanReturnValue(args.This());
    }
}

class ObjectEncoder::Job : public ThreadPool::Job
{
private:
    ObjectEncoder& _encoder;
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
    explicit Job(
        ObjectEncoder& encoder,
        v8::Handle<v8::Object> encoder_handle,
        v8::Handle<v8::Value> buf_handle,
        v8::Handle<v8::Value> cb_handle)
        : _encoder(encoder)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _chunk(node::Buffer::Data(buf_handle), node::Buffer::Length(buf_handle))
        , _fragments(3)
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, encoder_handle);
        _persistent->Set(1, buf_handle);
    }

    virtual ~Job()
    {
        NanDisposePersistent(_persistent);
    }

    virtual void run() override
    {
        // _content_hash = Buf(32, 0);
        _content_hash = Crypto::digest(_chunk, _encoder._content_hash_type.c_str());

        // convergent encryption - use _content_hash as encryption key
        // const Buf& key = _content_hash;
        Buf key(32);
        RAND_bytes(key.data(), key.length());
        // IV is just zeros since the key is unique then IV is not needed
        static Buf iv(64, 0);
        // RAND_bytes(iv.data(), iv.length());
        Buf encrypted = Crypto::encrypt(_chunk, key, iv, _encoder._cipher_type.c_str());

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
            _fragments[i].hash = Crypto::hmac(_fragments[i].data, key, _encoder._block_hash_type.c_str());
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

NAN_METHOD(ObjectEncoder::push)
{
    NanScope();
    ObjectEncoder& self = *Unwrap<ObjectEncoder>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 2
        || !node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("ObjectEncoder::push expected arguments function(buffer,callback)");
    }
    Job* job = new Job(self, args.This(), args[0], args[1]);
    tpool.submit(job);
    NanReturnUndefined();
}

NAN_ACCESSOR_GETTER(ObjectEncoder::content_hash_type_getter)
{
    NanScope();
    ObjectEncoder& self = *Unwrap<ObjectEncoder>(info.This());
    NanReturnValue(NanNew(self._content_hash_type));
}

NAN_ACCESSOR_SETTER(ObjectEncoder::content_hash_type_setter)
{
    NanScope();
    ObjectEncoder& self = *Unwrap<ObjectEncoder>(info.This());
    self._content_hash_type = *NanAsciiString(value);
}

NAN_ACCESSOR_GETTER(ObjectEncoder::cipher_type_getter)
{
    NanScope();
    ObjectEncoder& self = *Unwrap<ObjectEncoder>(info.This());
    NanReturnValue(NanNew(self._cipher_type));
}

NAN_ACCESSOR_SETTER(ObjectEncoder::cipher_type_setter)
{
    NanScope();
    ObjectEncoder& self = *Unwrap<ObjectEncoder>(info.This());
    self._cipher_type = *NanAsciiString(value);
}

NAN_ACCESSOR_GETTER(ObjectEncoder::block_hash_type_getter)
{
    NanScope();
    ObjectEncoder& self = *Unwrap<ObjectEncoder>(info.This());
    NanReturnValue(NanNew(self._block_hash_type));
}

NAN_ACCESSOR_SETTER(ObjectEncoder::block_hash_type_setter)
{
    NanScope();
    ObjectEncoder& self = *Unwrap<ObjectEncoder>(info.This());
    self._block_hash_type = *NanAsciiString(value);
}
