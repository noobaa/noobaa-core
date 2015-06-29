#ifndef RABIN_H_
#define RABIN_H_

#include "common.h"
#include "poly.h"

template<typename HashType_>
class RabinFingerprint
{
public:
    typedef HashType_ HashType;
    class Config;

    explicit RabinFingerprint(const Config& conf)
        : _conf(conf)
        , _window(new uint8_t[conf.window_len])
    {
        reset();
    }

    ~RabinFingerprint() {
        delete[] _window;
    }

    HashType value()
    {
        return _fingerprint;
    }

    void reset()
    {
        memset(_window, 0, _conf.window_len);
        _window_pos = 0;
        _fingerprint = 0;
    }

    HashType update(uint8_t byte)
    {
        const HashType value = _conf.byte_const_hash[byte];
        uint8_t out = _window[_window_pos];
        _fingerprint = _conf.poly_class.shift_byte_left(_fingerprint) ^ _conf.byte_shift_window_table[out] ^ value;
        _window[_window_pos] = value;
        _window_pos = (_window_pos + 1) % _conf.window_len;
        return _fingerprint;
    }

private:
    const Config& _conf;
    uint8_t* _window;
    int _window_pos;
    HashType _fingerprint;
};

template<typename HashType_>
class RabinFingerprint<HashType_>::Config
{
public:
    explicit Config(
        HashType poly_,
        int degree_,
        int window_len_)
        : poly(poly_)
        , degree(degree_)
        , window_len(window_len_)
        , poly_class(poly, degree)
    {
        // the byte_shift_window_table keeps the value of each byte once it falls off the sliding window
        // which is essentially: byte << window (mod p)
        for (int i=0; i<256; ++i) {
            byte_shift_window_table[i] = poly_class.shifts_left(poly_class.mod(i), 8 * window_len);
        }
        // constant hash is used to translate every input byte before feeding it
        // for example this reduced the effect of sequences of zeros.
        for (int i=0; i<256; ++i) {
            byte_const_hash[i] = i + 1;
        }
    }
    // irreducible/primitive polynom reminder (top bit unneeded)
    const HashType poly;
    // polynom degree - the index of the top bit of the polynom
    const int degree;
    // window length in bytes for rolling hash
    const int window_len;
    // polynom instance with needed Galois Field functions
    const Poly<HashType> poly_class;
    // see explaination in ctor
    HashType byte_shift_window_table[256];
    HashType byte_const_hash[256];
};


#endif // RABIN_H_
