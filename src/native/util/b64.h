#pragma once

#include <stdint.h>

namespace noobaa
{

extern const char B64_ENCODE[64];
extern const uint8_t B64_DECODE[256];

static inline int
b64_encode_len(int len)
{
    return (len + 2) / 3 * 4;
}

static inline int
b64_decode_len(int len)
{
    return (len + 3) / 4 * 3;
}

static inline void
_b64_encode_word(const uint8_t* in, uint8_t* out)
{
    uint8_t x, y, z;
    x = in[0];
    y = in[1];
    z = in[2];
    out[0] = B64_ENCODE[x >> 2];
    out[1] = B64_ENCODE[((x & 3) << 4) | (y >> 4)];
    out[2] = B64_ENCODE[((y & 15) << 2) | (z >> 6)];
    out[3] = B64_ENCODE[z & 63];
}

static inline void
_b64_encode_tail1(const uint8_t* in, uint8_t* out)
{
    uint8_t x;
    x = in[0];
    out[0] = B64_ENCODE[x >> 2];
    out[1] = B64_ENCODE[(x & 3) << 4];
    out[2] = '=';
    out[3] = '=';
}

static inline void
_b64_encode_tail2(const uint8_t* in, uint8_t* out)
{
    uint8_t x, y;
    x = in[0];
    y = in[1];
    out[0] = B64_ENCODE[x >> 2];
    out[1] = B64_ENCODE[((x & 3) << 4) | (y >> 4)];
    out[2] = B64_ENCODE[((y & 15) << 2)];
    out[3] = '=';
}

static inline int
_b64_decode_word(const uint8_t* in, uint8_t* out)
{
    uint8_t a, b, c, d;
    a = B64_DECODE[in[0]];
    b = B64_DECODE[in[1]];
    c = B64_DECODE[in[2]];
    d = B64_DECODE[in[3]];
    if (a >= 64) return -1;
    if (b >= 64) return -2;
    if (c >= 64) return -3;
    if (d >= 64) return -4;
    out[0] = (a << 2) | (b >> 4);
    out[1] = ((b & 15) << 4) | (c >> 2);
    out[2] = ((c & 3) << 6) | d;
    return 3;
}

static inline int
_b64_decode_tail(const uint8_t* in, uint8_t* out)
{
    uint8_t a, b, c, d;
    a = B64_DECODE[in[0]];
    b = B64_DECODE[in[1]];
    c = B64_DECODE[in[2]];
    d = B64_DECODE[in[3]];
    if (a >= 64) return -1;
    if (b >= 64) return -2;
    if (c > 64) return -3;
    if (d > 64) return -4;
    out[0] = (a << 2) | (b >> 4);
    if (c == 64 && d == 64) return 1;
    out[1] = ((b & 15) << 4) | (c >> 2);
    if (d == 64) return 2;
    out[2] = ((c & 3) << 6) | d;
    return 3;
}

static inline int
b64_encode(const uint8_t* in, int len, uint8_t* out)
{
    const int align = len % 3;
    const uint8_t* base = out;
    const uint8_t* end = in + len - align;
    while (in < end) {
        _b64_encode_word(in, out);
        in += 3;
        out += 4;
    }
    const int total = static_cast<int>(out - base);
    switch (align) {
    case 1:
        _b64_encode_tail1(in, out);
        return total + 4;
    case 2:
        _b64_encode_tail2(in, out);
        return total + 4;
    default:
        return total;
    }
}

static inline int
b64_decode(const uint8_t* in, int len, uint8_t* out)
{
    int r;
    const uint8_t* base = out;
    const uint8_t* end = in + len - 4;
    if (len == 0) return 0;
    if (len < 0) return -1;
    // if (len % 4) return -1;
    while (in < end) {
        r = _b64_decode_word(in, out);
        if (r < 0) {
            const int total = static_cast<int>(out - base);
            return -total + r; // negative
        }
        in += 4;
        out += 3;
    }
    const int total = static_cast<int>(out - base);
    r = _b64_decode_tail(in, out);
    if (r < 0) return -total + r; // negative
    return total + r;
}
}
