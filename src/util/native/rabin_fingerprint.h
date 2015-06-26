#ifndef RABIN_H_
#define RABIN_H_

#include "common.h"
#include "poly.h"

template<typename HashType_>
class RabinFingerprint
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
            , poly_class(poly, degree)
        {
            // the byte_out_table keeps the value of each byte once it falls off the sliding window
            // which is essentially: byte << window (mod p)
            for (int i=0; i<256; ++i) {
                byte_out_table[i] = poly_class.shifts_left(poly_class.mod(i), 8*window_len);
            }
        }
        // irreducible/primitive polynom reminder (top bit unneeded)
        const HashType poly;
        // polynom degree - the index of the top bit of the polynom
        const int degree;
        // window length in bytes for rolling hash
        const int window_len;
        //
        const Poly<HashType> poly_class;
        // explain ...
        HashType byte_out_table[256];
    };

public:

    explicit RabinFingerprint(const Config& conf)
        : _conf(conf)
        , _fingerprint(0)
        , _window_pos(0)
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
        _fingerprint = 0;
        _window_pos = 0;
        memset(_window, 0, _conf.window_len);
    }

    HashType update(uint8_t byte)
    {
        // add 1 to make immune to long sequences of 0
        const HashType value = byte + 1;
        uint8_t out = _window[_window_pos];
        // std::cout << std::hex << "Fingerprint " << _fingerprint << " Value " << value << " Out " << int(out) << std::endl;
        _fingerprint = _conf.poly_class.shift_byte_left(_fingerprint);
        _fingerprint ^= _conf.byte_out_table[out];
        _fingerprint ^= value;
        _window[_window_pos] = value;
        _window_pos = (_window_pos + 1) % _conf.window_len;
        return _fingerprint;
    }

protected:
    const Config& _conf;
    HashType _fingerprint;
    int _window_pos;
    uint8_t* _window;
};

#endif // RABIN_H_
