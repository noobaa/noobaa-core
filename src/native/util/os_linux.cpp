/* Copyright (C) 2016 NooBaa */
#ifdef __linux__

#include "common.h"

#include <sys/syscall.h>
#include <sys/types.h>
#include <grp.h>
#include <limits.h>

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

const std::vector<gid_t> ThreadScope::orig_groups = [] {
    std::vector<gid_t> groups(NGROUPS_MAX);
    int r = getgroups(NGROUPS_MAX, &groups[0]);
    groups.resize(r);
    return groups;
}();

/**
 * set the effective uid/gid of the current thread using direct syscalls
 * unsets the supplementary group IDs for the current thread using direct syscall 
 * we have to bypass the libc wrappers because posix requires it to syncronize
 * uid & gid to all threads which is undesirable in our case.
 */
void
ThreadScope::change_user()
{
    if (_uid != orig_uid || _gid != orig_gid) {
        // must change gid first otherwise will fail on permission
        MUST_SYS(syscall(SYS_setgroups, 0, NULL));
        MUST_SYS(syscall(SYS_setresgid, _gid, _gid, -1));
        MUST_SYS(syscall(SYS_setresuid, _uid, _uid, -1));
    }
}

/**
 * restores the effective uid/gid & supplementary_groups to the orig_uid/orig_gid/orig_groups
 */
void
ThreadScope::restore_user()
{
    if (_uid != orig_uid || _gid != orig_gid) {
        // must restore uid first otherwise will fail on permission
        MUST_SYS(syscall(SYS_setresuid, orig_uid, orig_uid, -1));
        MUST_SYS(syscall(SYS_setresgid, orig_gid, orig_gid, -1));
        MUST_SYS(syscall(SYS_setgroups, ThreadScope::orig_groups.size(), &ThreadScope::orig_groups[0]));
    }
}

} // namespace noobaa

#endif
