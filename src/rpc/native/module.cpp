#include "nudp.h"

static void
setup(v8::Handle<v8::Object> exports)
{
    Nudp::setup(exports);
}

NODE_MODULE(native_rpc, setup)
