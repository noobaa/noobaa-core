#include "dedup.h"

static void
setup(HOBJ exports)
{
    Dedup_v1::setup("Dedup_v1", exports);
}

NODE_MODULE(native_util, setup)
