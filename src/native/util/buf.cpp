/* Copyright (C) 2016 NooBaa */
#include "buf.h"

namespace noobaa
{

const char Buf::HEX_CHARS[] = {
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'
};

void
Buf::hexdump(const void* p, size_t len, const char* prefix)
{
    const char* pc = reinterpret_cast<const char*>(p);
    int count = 0;
    while (len--) {
        if (count == 0) {
            if (prefix) {
                fprintf(stderr, "%s ", prefix);
            }
            fprintf(stderr, "%p: ", (void*)pc);
        }
        fprintf(stderr, " %02x", *pc++ & 0xff);
        count++;
        if (count == 16) {
            fprintf(stderr, "   ");
            for (const char* ppc = pc - count; ppc < pc; ++ppc) {
                fprintf(stderr, "%c", isprint(*ppc) ? *ppc : '.');
            }
            fprintf(stderr, "\n");
            count = 0;
        }
    }
    if (count != 0) {
        for (int i = count; i < 17; ++i) {
            fprintf(stderr, "   ");
        }
        for (const char* ppc = pc - count; ppc < pc; ++ppc) {
            fprintf(stderr, "%c", isprint(*ppc) ? *ppc : '.');
        }
        fprintf(stderr, "\n");
    }
}

} // namespace noobaa
