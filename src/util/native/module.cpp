#include "crypto.h"
#include "tpool.h"
#include "dedup_chunker.h"
#include "object_coding.h"

static void
setup(v8::Handle<v8::Object> exports)
{
    Crypto::init();
    ThreadPool::setup(exports);
    DedupChunker::setup(exports);
    ObjectCoding::setup(exports);
}

NODE_MODULE(native_util, setup)
