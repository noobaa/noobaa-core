#ifndef NOOBAA__RABIN_KARP__H
#define NOOBAA__RABIN_KARP__H

namespace noobaa {

template <typename _T>
class RabinKarp
{
public:
    typedef _T T;

    explicit RabinKarp(T multiplier, T modulo, int window_len)
        : _multiplier(multiplier)
        , _modulo(modulo)
    {
        // check that the type T can hold a multiplication witout wrapping
        assert(T(_multiplier * _multiplier) / _multiplier == _multiplier);
        // the window_mult_table keeps the value of each byte once it falls off the sliding window
        // which is essentially: byte << window (mod p)
        for (int i=0; i<256; ++i) {
            T a(i % _modulo);
            for (int j=0; j<window_len; ++j) {
                a = (a * _multiplier) % _modulo;
            }
            window_mult_table[i] = a;
        }
    }

    T update(T hash, uint8_t byte_in, uint8_t byte_out) const
    {
        hash = (hash * _multiplier)
               + byte_in
               + (_modulo - window_mult_table[byte_out]);
        return hash % _modulo;
    }

private:
    // the prime modulos
    const T _multiplier;
    const T _modulo;
    // see explanation in ctor
    T window_mult_table[256];
};

} // namespace noobaa

#endif // NOOBAA__RABIN_KARP__H
