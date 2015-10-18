#ifndef NOOBAA__NAT__H
#define NOOBAA__NAT__H

#include "../util/common.h"

namespace noobaa {

class NAT
{
public:

    /**
     * detect stun packet according to header first byte
     * the packet needs to have at least one byte
     */
    static bool is_stun_packet(const void* packet, int len) {
        assert(len >= 1);
        uint8_t first_byte = reinterpret_cast<const uint8_t*>(packet)[0];
        uint8_t bit1 = first_byte & 0x80;
        uint8_t bit2 = first_byte & 0x40;
        return bit1 == 0 && bit2 == 0;
    }

};

} // namespace noobaa

#endif // NOOBAA__NAT__H
