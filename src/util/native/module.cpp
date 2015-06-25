#include "ingest.h"

static void
setup(v8::Handle<v8::Object> exports)
{
    Ingest_v1::setup(exports);
}

NODE_MODULE(native_util, setup)
