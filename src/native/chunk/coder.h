/* Copyright (C) 2016 NooBaa */
#pragma once

#include "../util/struct_buf.h"
#include <stdint.h>

namespace noobaa
{

enum class NB_Coder_Type {
    ENCODER,
    DECODER
};

enum class NB_Parity_Type {
    NONE,
    C1,
    RS,
    CM
};

typedef char NB_Coder_Short_String[32];

struct NB_Coder_Frag {
    struct NB_Bufs block;
    struct NB_Buf digest;
    int data_index;
    int parity_index;
    int lrc_index;
};

struct NB_Coder_Chunk {
    NB_Coder_Short_String digest_type;
    NB_Coder_Short_String frag_digest_type;
    NB_Coder_Short_String compress_type;
    NB_Coder_Short_String cipher_type;
    NB_Coder_Short_String parity_type;

    struct NB_Bufs data;
    struct NB_Bufs errors;
    struct NB_Buf digest;
    struct NB_Buf cipher_key;
    struct NB_Buf cipher_iv;
    struct NB_Buf cipher_auth_tag;
    struct NB_Coder_Frag* frags;

    NB_Coder_Type coder;
    int size;
    int compress_size;
    int data_frags;
    int parity_frags;
    int lrc_group;
    int lrc_frags;
    int frags_count;
    int frag_size;
};

void nb_chunk_coder_init();

void nb_chunk_init(struct NB_Coder_Chunk* chunk);
void nb_chunk_free(struct NB_Coder_Chunk* chunk);
void nb_chunk_coder(struct NB_Coder_Chunk* chunk);
void nb_chunk_error(struct NB_Coder_Chunk* chunk, const char* str, ...);

void nb_frag_init(struct NB_Coder_Frag* f);
void nb_frag_free(struct NB_Coder_Frag* f);
}
