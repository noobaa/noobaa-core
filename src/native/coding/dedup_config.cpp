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
    NAN_COPY_OPTIONS_TO_WRAPPER(self, options);
    int gf_degree = NAN_GET_INT(self, "gf_degree");
    T gf_poly = NAN_GET_INT(self, "gf_poly");
    int window_len = NAN_GET_INT(self, "window_len");
    int min_chunk = NAN_GET_INT(self, "min_chunk");
    int max_chunk = NAN_GET_INT(self, "max_chunk");
    int avg_chunk_bits = NAN_GET_INT(self, "avg_chunk_bits");
    T AVG_CHUNK_VAL = ~T(0); // arbitrary fixed value
    ASSERT(min_chunk <= max_chunk,
        DVAL(min_chunk) << " should be smaller than " << DVAL(max_chunk));
    ASSERT(avg_chunk_bits < gf_degree,
        DVAL(avg_chunk_bits) << " should be smaller than " << DVAL(gf_degree));
    DedupConfig* config = new DedupConfig(
        gf_degree,
        gf_poly,
        window_len,
        min_chunk,
        max_chunk,
        avg_chunk_bits,
        AVG_CHUNK_VAL);
    config->Wrap(self);
    info.GetReturnValue().Set(self);
}

} // namespace noobaa
