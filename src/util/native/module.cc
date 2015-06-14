#include "rabin.h"

static void
initialize(HOBJ exports)
{
    Rabin::initialize(exports);
}

NODE_MODULE(native_util, initialize)
