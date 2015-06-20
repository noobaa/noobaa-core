#ifndef RABIN_H_
#define RABIN_H_

#include "common.h"

#define RABIN_TDEF \
    typename HashType, \
    uint8_t POLY_DEGREE, \
    HashType POLY_REM, \
    uint8_t WINDOW_LEN

#define RABIN_TARGS \
    HashType, \
    POLY_DEGREE, \
    POLY_REM, \
    WINDOW_LEN

template<RABIN_TDEF>
class Rabin
{
public:
    explicit Rabin();
    ~Rabin();
    HashType value() { return _fingerprint; }
    void update(uint8_t byte);
protected:
    static const HashType CARRY_BIT = HashType(1) << (POLY_DEGREE - 1);
    static const HashType CARRY_BYTE = HashType(0xFF) << (POLY_DEGREE - 9);
    HashType _fingerprint;
    uint8_t _window_pos;
    uint8_t _window[WINDOW_LEN];
};

#include "rabin.hpp"

#endif // RABIN_H_
