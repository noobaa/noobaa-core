#include "nudp.h"

static void
setup(HOBJ exports)
{
    Nudp::setup(exports);
}

NODE_MODULE(native_rpc, setup)
