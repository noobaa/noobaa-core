#ifndef RABIN_H_
#define RABIN_H_

#include "common.h"

template<typename HashType_>
class Rabin
{

public:

    typedef HashType_ HashType;

    class Config
    {
public:
        explicit Config(
            HashType poly_,
            int degree_,
            int window_len_)
            : poly(poly_)
            , degree(degree_)
            , window_len(window_len_)
            , carry_bit(HashType(1) << (degree_ - 1))
        {
            for (int i=0; i<256; i++) {
                byte_out_table[i] = i; // TODO
            }
        }
        /* irreducible/primitive polynom reminder (top bit unneeded) */
        const HashType poly;
        /* polynom degree - the index of the top bit of the polynom */
        const int degree;
        /* window length in bytes for rolling hash */
        const int window_len;
        // the last bit before the degree
        const HashType carry_bit;
        //
        HashType byte_out_table[256];
    };

public:

    explicit Rabin(const Config& conf)
        : _conf(conf)
        , _fingerprint(0)
        , _window_pos(0)
        , _window(new uint8_t[conf.window_len])
    {
    }

    ~Rabin() {
        delete[] _window;
    }

    HashType value()
    {
        return _fingerprint;
    }

    void reset()
    {
        _fingerprint = 0;
        memset(_window, 0, _conf.window_len);
    }

    HashType update(uint8_t byte);

protected:
    const Config& _conf;
    HashType _fingerprint;
    int _window_pos;
    uint8_t* _window;
};

#include "rabin.hpp"

#endif // RABIN_H_
