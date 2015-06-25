// template hpp

template<typename HashType_>
HashType_
Rabin<HashType_>::update(uint8_t byte)
{
    // add 1 to make immune to long sequences of 0
    const HashType value = byte + 1;

    uint8_t out = _window[_window_pos];
    _fingerprint ^= out;

#ifdef RABIN_BIT_BY_BIT
    const HashType poly = _conf.poly;
    const HashType carry_bit = _conf.carry_bit;
    for (int i=0; i<8; i++) {
        if (_fingerprint & carry_bit) {
            _fingerprint = (_fingerprint << 1) ^ poly;
        } else {
            _fingerprint <<= 1;
        }
    }
#else
    _fingerprint ^= _conf.byte_out_table[out];
#endif

    _fingerprint ^= value;
    _window[_window_pos] = value;
    _window_pos = (_window_pos + 1) % _conf.window_len;
    return _fingerprint;
}
