#include "dedup_chunker.h"
#include "../util/buf.h"
#include "../util/crypto.h"

namespace noobaa {

Nan::Persistent<v8::Function> DedupConfig::_ctor;

NAN_MODULE_INIT(DedupConfig::setup)
{
    auto name = "DedupConfig";
    auto tpl(Nan::New<v8::FunctionTemplate>(DedupConfig::new_instance));
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);
}

NAN_METHOD(DedupConfig::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    v8::Local<v8::Object> self = info.This();
    v8::Local<v8::Object> options = info[0]->ToObject();
    // TODO load values from wrapper
    DedupConfig* chunker = new DedupConfig(
        GF_DEGREE,
        GF_POLY,
        WINDOW_LEN,
        MIN_CHUNK,
        MAX_CHUNK,
        AVG_CHUNK_BITS,
        AVG_CHUNK_VAL);
    chunker->Wrap(self);
    NAN_COPY_OPTIONS_TO_WRAPPER(self, options);
    info.GetReturnValue().Set(self);
}

} // namespace noobaa
