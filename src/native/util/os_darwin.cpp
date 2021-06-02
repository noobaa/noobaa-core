/* Copyright (C) 2016 NooBaa */
#ifdef __APPLE__

#include "common.h"
#include <sys/kauth.h> // for KAUTH_UID_NONE

namespace noobaa
{

/**
 * get the effective uid/gid of the current thread using pthread_getugid_np()
 * this is the only per-thread api to do so, and although it is deprecated,
 * we don't seem to have another way.
 * See https://www.unix.com/man-page/osx/2/pthread_setugid_np/
 */
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
static auto _mac_thread_getugid = pthread_getugid_np;
static auto _mac_thread_setugid = pthread_setugid_np;
#pragma GCC diagnostic pop

pid_t
get_current_tid()
{
    return pthread_mach_thread_np(pthread_self());
}

uid_t
get_current_uid()
{
    uid_t uid;
    gid_t gid;
    MUST_SYS(_mac_thread_getugid(&uid, &gid));
    return uid;
}

const uid_t ThreadScope::orig_uid = getuid();
const gid_t ThreadScope::orig_gid = getgid();

void
ThreadScope::change_user()
{
    if (_uid != orig_uid || _gid != orig_gid) {
        MUST_SYS(_mac_thread_setugid(_uid, _gid));
    }
}

void
ThreadScope::restore_user()
{
    if (_uid != orig_uid || _gid != orig_gid) {
        MUST_SYS(_mac_thread_setugid(KAUTH_UID_NONE, KAUTH_UID_NONE));
    }
}

} // namespace noobaa

#endif
