#include <iostream>
#include <stdint.h>
#include "crc32.h"
using namespace std;
int main()
{
    char buf[128*1024];
    uint32_t crc = 0;
    while (!cin.eof()) {
        cin.read(buf, sizeof buf);
        crc = crc32_fast(buf, cin.gcount(), crc);
    }
    cout << hex << crc << endl;
}
