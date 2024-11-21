/* Copyright (C) 2016 NooBaa */
#ifdef __APPLE__

#include "common.h"
#include <sys/kauth.h> // for KAUTH_UID_NONE
#include <sys/param.h>
#include <unistd.h>
#include <algorithm>

namespace noobaa
{

/**
 * get the effective uid/gid of the current thread using pthread_getugid_np()
 * this is the only per-thread api to do so, and although it is deprecated,
 * we don't seem to have another way.
 * pthread_setugid_np sets the effective uid/gid and clears the supplementary groups of the current thread
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
const std::vector<gid_t> ThreadScope::orig_groups = get_process_groups();


/**
 * set the effective uid/gid/supplemental_groups of the current thread using pthread_getugid_np and setgroups
 * we have to bypass the libc wrappers because posix requires it to syncronize
 * uid, gid & supplemental_groups to all threads which is undesirable in our case.
 * this way is deprecated, but we don't seem to have another way.
 * pthread_setugid_np sets the effective uid/gid and clears the supplementary groups of the current thread
 * See https://www.unix.com/man-page/osx/2/pthread_setugid_np/
 * regarding setgroups When called from a thread running under an assumed per-thread identity,
 * this function will operate against the per-thread. so we have to run it after _mac_thread_setugid.
 * also _mac_thread_setugid will reset the groups array anyway
 * https://github.com/apple/darwin-xnu/blame/main/bsd/kern/kern_prot.c (see setgroups1)
 */
void
ThreadScope::change_user()
{
    if (_uid != orig_uid || _gid != orig_gid) {
        MUST_SYS(_mac_thread_setugid(_uid, _gid));
        if (!_groups.empty()) {
            /*accourding to BSD Manual https://man.freebsd.org/cgi/man.cgi?query=setgroups
            which darwin is occasionally compliant to setgroups changes the effective gid according to
            the first element on the list. add the effective gid as the first element to prevent issues*/
            _groups.push_back(_gid);
            std::swap(_groups.front(), _groups.back());
            MUST_SYS(setgroups(_groups.size(), &_groups[0]));
        }
    }
}

void
ThreadScope::restore_user()
{
    if (_uid != orig_uid || _gid != orig_gid) {
        MUST_SYS(_mac_thread_setugid(KAUTH_UID_NONE, KAUTH_UID_NONE));
        MUST_SYS(setgroups(orig_groups.size(), &orig_groups[0]));
    }
}

int
ThreadScope::add_thread_capabilities()
{
    //set capabilities not used in darwin
    LOG("function set_capabilities_linkat is unsupported in darwin");
    return -1;
}

std::vector<gid_t>
ThreadScope::get_process_groups() {
    std::vector<gid_t> groups(NGROUPS_MAX);
    int r = getgroups(NGROUPS_MAX, &groups[0]);
    groups.resize(r);
    return groups;
}

} // namespace noobaa

#endif
