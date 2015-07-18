#include "crypto.h"
#include "tpool.h"
#include "write_processor.h"
#include "read_processor.h"

static void
setup(v8::Handle<v8::Object> exports)
{
    Crypto::init();
    ThreadPool::setup(exports);
    WriteProcessor::setup(exports);
    ReadProcessor::setup(exports);
}

NODE_MODULE(native_util, setup)
