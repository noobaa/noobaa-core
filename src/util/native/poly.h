#ifndef POLY_H_
#define POLY_H_

#include <cstdint>

class Poly
{
public:
    Poly(uint64_t poly, uint16_t deg)
        : _poly(poly)
        , _deg(deg)
    {

    }

private:
    uint64_t _poly;
    uint16_t _deg;
};

#endif // POLY_H_
