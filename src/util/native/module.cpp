#include "ingest.h"

static void
setup(HOBJ exports)
{
    Ingest_v1::setup(exports);
}

NODE_MODULE(native_util, setup)
