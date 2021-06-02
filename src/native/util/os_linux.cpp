/* Copyright (C) 2016 NooBaa */
#ifdef __linux__

#include "common.h"

#include <sys/syscall.h>
#include <sys/types.h>

namespace noobaa
{

pid_t
get_current_tid()
{
    return syscall(SYS_gettid);
}

uid_t
get_current_uid()
{
    return syscall(SYS_geteuid);
}

const uid_t ThreadScope::orig_uid = getuid();
const gid_t ThreadScope::orig_gid = getgid();

/**
 * set the effective uid/gid of the current thread using direct syscalls -
 * we have to bypass the libc wrappers because posix requires it to syncronize
 * uid & gid to all threads which is undesirable in our case.
 */
void
ThreadScope::change_user()
{
    if (_uid != orig_uid || _gid != orig_gid) {
        // must change gid first otherwise will fail on permission
        MUST_SYS(syscall(SYS_setresgid, -1, _gid, -1));
        MUST_SYS(syscall(SYS_setresuid, -1, _uid, -1));
    }
}

void
ThreadScope::restore_user()
{
    if (_uid != orig_uid || _gid != orig_gid) {
        // must restore uid first otherwise will fail on permission
        MUST_SYS(syscall(SYS_setresuid, -1, orig_uid, -1));
        MUST_SYS(syscall(SYS_setresgid, -1, orig_gid, -1));
    }
}

} // namespace noobaa

#endif
