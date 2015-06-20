#include "dedup.h"

static void
initialize(HOBJ exports)
{
    Dedup_v1::initialize("Dedup_v1", exports);
}

NODE_MODULE(native_util, initialize)
