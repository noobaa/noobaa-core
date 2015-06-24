// template hpp

template<typename HashType_>
HashType_
Rabin<HashType_>::update(uint8_t byte)
{
    // add 1 to make immune to long sequences of 0
    const HashType value = byte + 1;
    const HashType carry_bit = _conf.carry_bit;
    const HashType poly = _conf.poly;

    uint8_t out = _window[_window_pos];
    _fingerprint ^= out;

#ifdef PUSH_WHOLE_BYTE
    HashType out_poly = _out_table[out];
    _fingerprint ^= out_poly;
#else
    for (int i=0; i<8; i++) {
        if (_fingerprint & carry_bit) {
            _fingerprint = (_fingerprint << 1) ^ poly;
        } else {
            _fingerprint <<= 1;
        }
    }
#endif

    _fingerprint ^= value;
    _window[_window_pos] = value;
    _window_pos = (_window_pos + 1) % _conf.window_len;
    return _fingerprint;
}
