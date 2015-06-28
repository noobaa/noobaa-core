#include "ingest.h"
#include "ssl.h"

static void
setup(v8::Handle<v8::Object> exports)
{
    ssl_init();
    Ingest_v1::setup(exports);
}

NODE_MODULE(native_util, setup)
