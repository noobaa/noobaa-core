#include "util/crypto.h"
#include "util/tpool.h"
#include "coding/dedup_chunker.h"
#include "coding/object_coding.h"
#include "n2n/nudp.h"

NAN_MODULE_INIT(setup)
{
    Crypto::init();
    ThreadPool::setup(target);
    DedupChunker::setup(target);
    ObjectCoding::setup(target);
    Nudp::setup(target);
}

NODE_MODULE(native_core, setup)
