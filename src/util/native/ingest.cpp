#include "ingest.h"
#include "buf.h"
#include "crypto.h"

// statics

v8::Persistent<v8::Function> Ingest_v1::_ctor;

Ingest_v1::RabinHasher::Config
Ingest_v1::_rabin_hasher_conf(
    0x9u,   /* poly */
    31u,    /* degree */
    16u     /* window_len */
    );

Ingest_v1::BuzHasher::Config
Ingest_v1::_buz_hasher_conf(
    31u,    /* degree */
    16u     /* window_len */
    );

Ingest_v1::Deduper::Config
Ingest_v1::_deduper_conf(
    3u*128*1024,    /* min_chunk */
    6u*128*1024,    /* max_chunk */
    18u,            /* avg_chunk_bits */
    0x07071070u     /* avg_chunk_val */
    );

void
Ingest_v1::setup(v8::Handle<v8::Object> exports)
{
    auto name = "Ingest_v1";
    auto tpl(NanNew<v8::FunctionTemplate>(Ingest_v1::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", Ingest_v1::push);
    NODE_SET_PROTOTYPE_METHOD(tpl, "flush", Ingest_v1::flush);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(Ingest_v1::new_instance)
{
    NanScope();
    if (args.IsConstructCall()) {
        if (!args[0]->IsFunction()) {
            return NanThrowError("expected function as first argument");
        }
        NanCallbackRef callback(new NanCallback(args[0].As<v8::Function>()));
        Ingest_v1* obj = new Ingest_v1(callback);
        obj->Wrap(args.This());
        NanReturnValue(args.This());
    } else {
        // Invoked as plain function `Ingest_v1(...)`, turn into construct call.
        const int argc = 1;
        v8::Local<v8::Value> argv[argc] = { args[0] };
        NanReturnValue(_ctor->NewInstance(argc, argv));
    }
}

NAN_METHOD(Ingest_v1::push)
{
    NanScope();
    auto self = Unwrap<Ingest_v1>(args.This());

    if (args.Length() != 2
        || !node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("Ingest_v1::push expected arguments function(buffer,callback)");
    }
    Buf buf(args[0]);
    NanCallbackRef callback(new NanCallback(args[1].As<v8::Function>()));

    // std::cout << "Ingest_v1::push start " << std::dec << buf.length() << std::endl;
    self->_deduper.push(buf);
    // std::cout << "Ingest_v1::push pushed " << std::dec << buf.length() << std::endl;
    self->purge_chunks();

    v8::Handle<v8::Value> argv[] = {};
    callback->Call(0, argv);

    NanReturnUndefined();
}

NAN_METHOD(Ingest_v1::flush)
{
    NanScope();
    auto self = Unwrap<Ingest_v1>(args.This());

    if (args.Length() != 1
        || !args[0]->IsFunction()) {
        return NanThrowError("Ingest_v1::flush expected arguments function(callback)");
    }
    NanCallbackRef callback(new NanCallback(args[0].As<v8::Function>()));

    // std::cout << "Ingest_v1::flush start" << std::endl;
    self->_deduper.flush();
    // std::cout << "Ingest_v1::flush flushed" << std::endl;
    self->purge_chunks();

    v8::Handle<v8::Value> argv[] = {};
    callback->Call(0, argv);

    NanReturnUndefined();
}

void
Ingest_v1::purge_chunks()
{
    while (_deduper.has_chunks()) {
        Buf chunk(_deduper.pop_chunk());
        std::string sha = Crypto::digest("sha512", chunk);
        v8::Handle<v8::Value> argv[] = { chunk.handle(), NanNew(sha) };
        _callback->Call(2, argv);
    }
}
