/*
 * Usage:
 * $ node-gyp -C src/native/test/ rebuild
 * $ sudo src/native/test/build/Release/os_test
 */
#include "../util/common.h"

using namespace noobaa;

void*
thread_main(void* data)
{
    usleep(1);
    for (int i = 0; i < 1000; ++i) {
        ThreadScope tx;
        tx.set_user(2000, 500);
        LOG("thread tid " << get_current_tid() << " uid " << get_current_uid());
        usleep(1);
    }
    return 0;
}

int
main()
{
    LOG("start: uid " << getuid());

    pthread_t pt;
    MUST0(pthread_create(&pt, 0, thread_main, 0));

    usleep(1);
    for (int i = 0; i < 1000; ++i) {
        ThreadScope tx;
        tx.set_user(1000, 500);
        LOG("main tid " << get_current_tid() << " uid " << get_current_uid());
        usleep(1);
    }

    MUST0(pthread_join(pt, 0));
    return 0;
}
