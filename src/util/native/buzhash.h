#ifndef BUZHASH_H_
#define BUZHASH_H_

/**
 *
 * Cyclic polynomials hashing
 *
 * fast and good.
 *
 * http://arxiv.org/pdf/0705.4676v7.pdf
 *
 */
template <typename HashType_>
class BuzHash
{
public:
    typedef HashType_ HashType;
    class Config;

    explicit BuzHash(const Config& conf)
        : _conf(conf)
        , _window(new uint8_t[conf.window_len])
    {
        reset();
    }

    ~BuzHash()
    {
        delete[] _window;
    }

    HashType value()
    {
        return _hash;
    }

    void reset()
    {
        memset(_window, 0, _conf.window_len);
        _window_pos = 0;
        _hash = 0;
    }

    HashType update(uint8_t byte)
    {
        const HashType value = _conf.byte_const_hash[byte];
        uint8_t out = _window[_window_pos];
        _hash = _conf.rotate_byte_left(_hash) ^ _conf.byte_rotate_window_table[out] ^ value;
        _window[_window_pos] = value;
        _window_pos = (_window_pos + 1) % _conf.window_len;
        return _hash;
    }

private:
    const Config& _conf;
    uint8_t* _window;
    int _window_pos;
    HashType _hash;
};


template <typename HashType_>
class BuzHash<HashType_>::Config
{
public:
    explicit Config(int degree_, int window_len_)
        : degree(degree_)
        , window_len(window_len_)
    {
        // byte_rotate_window_table is the value of the byte rotated 'window_len'-times
        // this allows to remove the last window byte.
        for (int i=0; i<256; ++i) {
            byte_rotate_window_table[i] = rotate_left(i, 8 * window_len);
        }
        // constant hash is used to translate every input byte before feeding it
        // for example this reduced the effect of sequences of zeros.
        for (int i=0; i<256; ++i) {
            byte_const_hash[i] = i + 1;
        }
    }

    HashType rotate_byte_left(HashType a) const
    {
        return (a >> (degree - 8)) | (a << 8);
    }

    HashType rotate_left(HashType a, int bits) const
    {
        while (bits > 8) {
            a = rotate_byte_left(a);
            bits -= 8;
        }
        if (bits > 0) {
            return (a >> (degree-bits)) | (a << bits);
        } else {
            return a;
        }
    }

    const int degree;
    const int window_len;
    // see explaination in ctor
    HashType byte_rotate_window_table[256];
    HashType byte_const_hash[256];
};

#endif // BUZHASH_H_
