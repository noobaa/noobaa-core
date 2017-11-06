/* Copyright (C) 2016 NooBaa */
#include "coding/dedup_chunker.h"
#include "coding/dedup_config.h"
#include "coding/object_coding.h"
#include "n2n/ntcp.h"
#include "n2n/nudp.h"
#include "util/tpool.h"

namespace noobaa
{

NAN_MODULE_INIT(setup)
{
    DedupConfig::setup(target);
    DedupChunker::setup(target);
    ObjectCoding::setup(target);

    Nudp::setup(target);
    Ntcp::setup(target);

    ThreadPool::setup(target);
}

NODE_MODULE(nb_native_nan, setup)

} // namespace noobaa
