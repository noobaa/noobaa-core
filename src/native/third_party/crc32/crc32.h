#ifndef CRC32_FAST_H
#define CRC32_FAST_H

uint32_t crc32_fast(const void* data, size_t length, uint32_t previousCrc32 = 0);
// uint32_t crc32_4bytes(const void* data, size_t length, uint32_t previousCrc32 = 0);

#endif // CRC32_FAST_H
