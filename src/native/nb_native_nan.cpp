/* Copyright (C) 2016 NooBaa */
#include "n2n/ntcp.h"
#include "n2n/nudp.h"

namespace noobaa
{

NAN_MODULE_INIT(setup)
{
    Nudp::setup(target);
    Ntcp::setup(target);
}

NODE_MODULE(nb_native_nan, setup)

} // namespace noobaa
