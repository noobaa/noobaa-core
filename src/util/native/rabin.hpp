// template hpp

template<RABIN_TDEF>
Rabin<RABIN_TARGS>
::Rabin()
    : _fingerprint(0)
    , _window_pos(0)
    , _window {0}
{

}

template<RABIN_TDEF>
Rabin<RABIN_TARGS>
::~Rabin()
{

}

template<RABIN_TDEF>
void
Rabin<RABIN_TARGS>
::update(uint8_t byte)
{
    byte += 1; // add 1 to make immune to long sequences of 0
    uint8_t out = _window[_window_pos];
    _fingerprint ^= out;

#ifdef PUSH_WHOLE_BYTE
    uint32_t out_poly = _out_table[out];
    _fingerprint ^= out_poly;
#else
    for (int i=0; i<8; i++) {
        if (_fingerprint & CARRY_BIT) {
            _fingerprint = (_fingerprint << 1) ^ POLY_REM;
        } else {
            _fingerprint <<= 1;
        }
    }
#endif

    _fingerprint ^= byte;
    _window[_window_pos] = byte;
    _window_pos = (_window_pos + 1) % WINDOW_LEN;
}
