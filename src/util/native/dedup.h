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
    typename HashType, \
    uint8_t POLY_DEGREE, \
    HashType POLY_REM, \
    uint8_t WINDOW_LEN, \
    uint32_t DEDUP_MIN_CHUNK, \
    uint32_t DEDUP_MAX_CHUNK, \
    uint32_t DEDUP_AVG_CHUNK_BITS, \
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

#define DEDUP_V1_ARGS \
    /* hash type - needs to be able to hold the polynom and do bitwize operations */ \
    uint32_t, \
    /* polynom degree */ \
    31u, \
    /* irreducible/primitive polynom reminder (top bit unneeded) */ \
    0x9u, \
    /* window length for rolling hash */ \
    128u, \
    /* minimum chunk length */ \
    3u*128*1024, \
    /* maximum chunk length */ \
    6u*128*1024, \
    /* number of lower bits used to match the hash value */ \
    18u, \
    /* hash value to match lower bits, can be any other value, but constant. */ \
    0x07071070u

typedef Dedup<DEDUP_V1_ARGS> Dedup_v1;

#include "dedup.hpp"

#endif // DEDUP_H_
