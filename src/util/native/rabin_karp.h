#ifndef RABIN_H_
#define RABIN_H_

template <typename _Hash>
class RabinKarp
{
public:
    typedef _Hash Hash;

    explicit RabinKarp(Hash multiplier, Hash modulo, int window_len)
        : _multiplier(multiplier)
        , _modulo(modulo)
    {
        assert()
        // the window_mult_table keeps the value of each byte once it falls off the sliding window
        // which is essentially: byte << window (mod p)
        for (int i=0; i<256; ++i) {
            Hash a(i % _modulo);
            for (int j=0; j<window_len; ++j) {
                a = (a * _multiplier) % _modulo;
            }
            window_mult_table[i] = a;
        }
    }

    Hash update(Hash hash, uint8_t byte_in, uint8_t byte_out) const
    {
        hash = (hash * _multiplier)
               + byte_in
               + (_modulo - window_mult_table[byte_out]);
        return hash % _modulo;
    }

private:
    // the prime modulos
    const Hash _multiplier;
    const Hash _modulo;
    // see explanation in ctor
    Hash window_mult_table[256];
};

#endif // RABIN_H_
