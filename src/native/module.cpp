#include "util/crypto.h"
#include "util/tpool.h"
#include "coding/dedup_config.h"
#include "coding/dedup_chunker.h"
#include "coding/object_coding.h"
#include "n2n/ntcp.h"
#include "n2n/nudp.h"
#include "util/syslog.h"

namespace noobaa {

/*
TODO cannot find node::HandleWrap class on include/ dir, need node sources???
NAN_METHOD(set_recv_buffer_size) {
    HandleWrap* handle_wrap = NAN_UNWRAP_OBJ(node::HandleWrap, info[0]);
    int size = info[1]->Int32Value();
    NAUV_CALL(uv_recv_buffer_size(handle_wrap->GetHandle(), &size));
}
NAN_METHOD(set_send_buffer_size) {
    HandleWrap* handle_wrap = NAN_UNWRAP_OBJ(node::HandleWrap, info[0]);
    int size = info[1]->Int32Value();
    NAUV_CALL(uv_send_buffer_size(handle_wrap->GetHandle(), &size));
}
*/

NAN_MODULE_INIT(setup)
{
    Crypto::init();
    ThreadPool::setup(target);
    DedupConfig::setup(target);
    DedupChunker::setup(target);
    ObjectCoding::setup(target);
    Nudp::setup(target);
    Ntcp::setup(target);
#ifndef WIN32
    Syslog::setup(target);
#endif
/*
    Nan::SetMethod(target, "set_recv_buffer_size", set_recv_buffer_size);
    Nan::SetMethod(target, "set_send_buffer_size", set_send_buffer_size);
*/
}

NODE_MODULE(native_core, setup)

} // namespace noobaa
