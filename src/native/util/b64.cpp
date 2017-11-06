#include "b64.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

namespace noobaa
{

#define FF 255

/* clang-format off */
const char B64_ENCODE[64] = {
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
    'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f',
    'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
    'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '/',
};

const uint8_t B64_DECODE[256] = {
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [0  - 16]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [16 - 32]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, 62, FF, FF, FF, 63, // [32 - 48] 43:'+' 47:'/'
    52, 53, 54, 55, 56, 57, 58, 59, 60, 61, FF, FF, FF, 64, FF, FF, // [48 - 64] 48:'0'-'9' 61:'='
    FF, 0,  1,  2,  3,  4,  5,  6,  7,  8,  9,  10, 11, 12, 13, 14, // [64 - 80] 65:'A'
    15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, FF, FF, FF, FF, FF, // [80 - 96]
    FF, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, // [96 -112] 97:'a'
    41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, FF, FF, FF, FF, FF, // [112-128]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [128-144]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [144-160]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [160-176]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [176-192]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [192-208]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [208-224]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [224-240]
    FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, FF, // [240-256]
};
/* clang-format on */

int
b64_main(int ac, char** av)
{
    uint8_t in[1024];
    uint8_t out[2 * sizeof(in)];
    int pending = 0;

    if (ac >= 2 && strcmp(av[1], "encode") == 0) {

        // encode av[2]
        if (ac >= 3) {
            const int n = strlen(av[2]);
            const int r = b64_encode((uint8_t*)av[2], n, out);
            if (r < 0) return r;
            assert(r == b64_encode_len(n));
            assert(r <= (int)sizeof(out));
            fwrite(out, 1, r, stdout);
            return 0;
        }

        // encode stdin
        while (!feof(stdin)) {
            pending += fread(in + pending, 1, sizeof(in) - pending, stdin);
            const int n = pending / 3 * 3;
            const int r = b64_encode(in, n, out);
            if (r < 0) return r;
            assert(r == b64_encode_len(n));
            assert(r <= (int)sizeof(out));
            fwrite(out, 1, r, stdout);
            pending -= n;
            memcpy(in, in + n, pending);
        }
        if (pending) {
            const int r = b64_encode(in, pending, out);
            if (r < 0) return r;
            fwrite(out, 1, r, stdout);
        }
        return 0;

    } else if (ac >= 2 && strcmp(av[1], "decode") == 0) {

        // decode av[2]
        if (ac >= 3) {
            const int n = strlen(av[2]);
            const int r = b64_decode((uint8_t*)av[2], n, out);
            if (r < 0) return 1;
            assert(r <= (int)sizeof(out));
            assert(r <= b64_decode_len(n));
            assert(r > b64_decode_len(n) - 4);
            fwrite(out, 1, r, stdout);
            return 0;
        }

        // decode stdin
        while (!feof(stdin)) {
            pending += fread(in + pending, 1, sizeof(in) - pending, stdin);
            const int n = pending / 4 * 4;
            const int r = b64_decode(in, n, out);
            if (r < 0) return r;
            assert(r <= (int)sizeof(out));
            assert(r <= b64_decode_len(n));
            assert(r > b64_decode_len(n) - 4);
            fwrite(out, 1, r, stdout);
            pending -= n;
            memcpy(in, in + n, pending);
        }
        if (pending) {
            const int r = b64_decode(in, pending, out);
            if (r < 0) return r;
            fwrite(out, 1, r, stdout);
        }
        return 0;

    } else {
        printf("Usage: encode|decode [input|stdin]\n");
        return 1;
    }
}
}
