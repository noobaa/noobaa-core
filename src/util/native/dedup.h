#ifndef DEDUP_H_
#define DEDUP_H_

#include "common.h"
#include "rabin.h"

/**
 *
 * DEDUP addon for nodejs
 *
 * takes nodejs buffers and chunking them with variable length dedup
 *
 */

#define DEDUP_TDEF \
    /* hash type - needs to be able to hold the polynom and do bitwize operations */ \
    typename HashType, \
    /* polynom degree - the index of the top bit of the polynom */ \
    uint8_t POLY_DEGREE, \
    /* irreducible/primitive polynom reminder (top bit unneeded) */ \
    HashType POLY_REM, \
    /* window length for rolling hash */ \
    uint8_t WINDOW_LEN, \
    /* minimum chunk length to avoid too small chunks, also used to fast skip for performance */ \
    uint32_t DEDUP_MIN_CHUNK, \
    /* maximum chunk length to avoid too large chunks */ \
    uint32_t DEDUP_MAX_CHUNK, \
    /* number of lower bits of the fingerprint used to match the hash value */ \
    uint32_t DEDUP_AVG_CHUNK_BITS, \
    /* hash value to match lower bits, can be any  value, but constant */ \
    HashType DEDUP_AVG_CHUNK_VAL

#define DEDUP_TARGS \
    HashType, \
    POLY_DEGREE, \
    POLY_REM, \
    WINDOW_LEN, \
    DEDUP_MIN_CHUNK, \
    DEDUP_MAX_CHUNK, \
    DEDUP_AVG_CHUNK_BITS, \
    DEDUP_AVG_CHUNK_VAL

#define DEDUP_V1_ARGS \
    uint32_t,       /* HashType */ \
    31u,            /* POLY_DEGREE */ \
    0x9u,           /* POLY_REM */ \
    128u,           /* WINDOW_LEN */ \
    3u*128*1024,    /* DEDUP_MIN_CHUNK */ \
    6u*128*1024,    /* DEDUP_MAX_CHUNK */ \
    18u,            /* DEDUP_AVG_CHUNK_BITS */ \
    0x07071070u     /* DEDUP_AVG_CHUNK_VAL */


template<DEDUP_TDEF>
class Dedup : public node::ObjectWrap
{
private:
    explicit Dedup();
    ~Dedup();

private:
    typedef Rabin<HashType, POLY_DEGREE, POLY_REM, WINDOW_LEN> RabinHasher;
    RabinHasher _hasher;

public:
    static void setup(const char* name, HOBJ exports);

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
};


typedef Dedup<DEDUP_V1_ARGS> Dedup_v1;

#include "dedup.hpp"

#endif // DEDUP_H_
