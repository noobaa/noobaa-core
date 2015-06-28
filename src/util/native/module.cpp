#include "ingest.h"
#include "crypto.h"

static void
setup(v8::Handle<v8::Object> exports)
{
    Crypto::init();
    Ingest_v1::setup(exports);
}

NODE_MODULE(native_util, setup)
