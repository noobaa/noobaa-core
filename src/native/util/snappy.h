/* Copyright (C) 2016 NooBaa */
#pragma once

#include "struct_buf.h"

namespace noobaa
{

int nb_snappy_compress(struct NB_Bufs* bufs, struct NB_Bufs* errors);
int nb_snappy_uncompress(struct NB_Bufs* bufs, struct NB_Bufs* errors);
}
