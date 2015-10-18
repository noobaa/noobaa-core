#include "util/crypto.h"
#include "util/tpool.h"
#include "coding/dedup_config.h"
#include "coding/dedup_chunker.h"
#include "coding/object_coding.h"
#include "n2n/nudp.h"

namespace noobaa {

NAN_MODULE_INIT(setup)
{
    Crypto::init();
    ThreadPool::setup(target);
    DedupConfig::setup(target);
    DedupChunker::setup(target);
    ObjectCoding::setup(target);
    Nudp::setup(target);
}

NODE_MODULE(native_core, setup)

} // namespace noobaa
