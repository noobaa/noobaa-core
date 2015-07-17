#include "ingest.h"
#include "crypto.h"
#include "tpool.h"

static void
setup(v8::Handle<v8::Object> exports)
{
    Crypto::init();
    Ingest::setup(exports);
    ThreadPool::setup(exports);
}

NODE_MODULE(native_util, setup)
