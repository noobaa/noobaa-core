#include "crypto.h"
#include "tpool.h"
#include "dedup_chunker.h"
#include "object_coding.h"

NAN_MODULE_INIT(setup)
{
    Crypto::init();
    ThreadPool::setup(target);
    DedupChunker::setup(target);
    ObjectCoding::setup(target);
}

NODE_MODULE(native_util, setup)
