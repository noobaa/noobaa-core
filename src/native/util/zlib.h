/* Copyright (C) 2016 NooBaa */
#pragma once

#include "struct_buf.h"

namespace noobaa
{

int nb_zlib_compress(struct NB_Bufs* bufs, struct NB_Bufs* errors);
int nb_zlib_uncompress(struct NB_Bufs* bufs, int uncompressed_len, struct NB_Bufs* errors);
}
