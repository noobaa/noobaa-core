#include "ingest.h"

// statics

v8::Persistent<v8::Function> Ingest_v1::_ctor;

Ingest_v1::Hasher::Config Ingest_v1::_hasher_conf(
    0x9u,   /* poly */
    31u,    /* degree */
    128u    /* window_len */
    );

Ingest_v1::Deduper::Config Ingest_v1::_deduper_conf(
    3u*128*1024,    /* min_chunk */
    6u*128*1024,    /* max_chunk */
    18u,            /* avg_chunk_bits */
    0x07071070u     /* avg_chunk_val */
    );

void
Ingest_v1::setup(HOBJ exports)
{
    auto name = "Ingest_v1";
    auto tpl(NanNew<v8::FunctionTemplate>(Ingest_v1::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", Ingest_v1::push);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(Ingest_v1::new_instance)
{
    NanScope();
    if (args.IsConstructCall()) {
        Ingest_v1* obj = new Ingest_v1();
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

    if (args.Length() < 1) {
        NanReturnUndefined();
    }

    auto buffer_object = args[0]->ToObject();
    const uint8_t* data = reinterpret_cast<const uint8_t*>(node::Buffer::Data(buffer_object));
    int len = node::Buffer::Length(buffer_object);

    self->_deduper.push(data, len);

    NanReturnUndefined();
}
