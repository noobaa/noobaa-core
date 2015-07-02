#include "ingest.h"
#include "buf.h"
#include "crypto.h"

// statics

v8::Persistent<v8::Function> Ingest::_ctor;

/*
Ingest::BuzHasher::Config
Ingest::_buz_hasher(
    31u,    // degree
    16u     // window_len
    );
*/

Ingest::RabinHasher
Ingest::_rabin_hasher(
    31u,    // degree
    0x9u,   // poly
    64u     // window_len
    );

Ingest::Deduper
Ingest::_deduper(
    Ingest::_rabin_hasher,
    64u,            // window_len
    3u*128*1024,    // min_chunk
    6u*128*1024,    // max_chunk
    18u,            // avg_chunk_bits
    0x07071070u     // avg_chunk_val
    );

void
Ingest::setup(v8::Handle<v8::Object> exports)
{
    auto name = "Ingest";
    auto tpl(NanNew<v8::FunctionTemplate>(Ingest::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", Ingest::push);
    NODE_SET_PROTOTYPE_METHOD(tpl, "flush", Ingest::flush);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(Ingest::new_instance)
{
    NanScope();
    if (args.IsConstructCall()) {
        if (!args[0]->IsFunction()) {
            return NanThrowError("expected function as first argument");
        }
        NanCallbackRef callback(new NanCallback(args[0].As<v8::Function>()));
        Ingest* obj = new Ingest(callback);
        obj->Wrap(args.This());
        NanReturnValue(args.This());
    } else {
        // Invoked as plain function `Ingest(...)`, turn into construct call.
        const int argc = 1;
        v8::Local<v8::Value> argv[argc] = { args[0] };
        NanReturnValue(_ctor->NewInstance(argc, argv));
    }
}

NAN_METHOD(Ingest::push)
{
    NanScope();
    auto self = Unwrap<Ingest>(args.This());

    if (args.Length() != 2
        || !node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("Ingest::push expected arguments function(buffer,callback)");
    }
    Buf buf(args[0]);
    NanCallbackRef callback(new NanCallback(args[1].As<v8::Function>()));

    // std::cout << "Ingest::push start " << std::dec << buf.length() << std::endl;
    self->_chunker.push(buf);
    // std::cout << "Ingest::push pushed " << std::dec << buf.length() << std::endl;
    self->purge_chunks();

    v8::Handle<v8::Value> argv[] = {};
    callback->Call(0, argv);

    NanReturnUndefined();
}

NAN_METHOD(Ingest::flush)
{
    NanScope();
    auto self = Unwrap<Ingest>(args.This());

    if (args.Length() != 1
        || !args[0]->IsFunction()) {
        return NanThrowError("Ingest::flush expected arguments function(callback)");
    }
    NanCallbackRef callback(new NanCallback(args[0].As<v8::Function>()));

    // std::cout << "Ingest::flush start" << std::endl;
    self->_chunker.flush();
    // std::cout << "Ingest::flush flushed" << std::endl;
    self->purge_chunks();

    v8::Handle<v8::Value> argv[] = {};
    callback->Call(0, argv);

    NanReturnUndefined();
}

void
Ingest::purge_chunks()
{
    while (_chunker.has_chunks()) {
        Buf chunk(_chunker.pop_chunk());
        Buf key(32);
        memset(key.data(), 0, key.length());
        Buf iv(0);
        Buf encrypted = Crypto::encrypt(chunk, key, iv, "aes-256-cbc");
        std::string sha = Crypto::digest(encrypted, "sha512");
        // TODO slice the buffer handles to sync with the Buf slice
        v8::Handle<v8::Value> argv[] = { chunk.handle(), encrypted.handle(), NanNew(sha) };
        _callback->Call(3, argv);
    }
}
