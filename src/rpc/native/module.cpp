#include "nudp.h"

static void
initialize(HOBJ exports)
{
    Nudp::initialize(exports);
}

NODE_MODULE(native_rpc, initialize)
