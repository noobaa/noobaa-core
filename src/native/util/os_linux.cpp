/* Copyright (C) 2016 NooBaa */
#ifdef __linux__

#include "common.h"

#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/capability.h>
#include <grp.h>
#include <limits.h>
#include <pwd.h>

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
long ThreadScope::passwd_buf_size = -1;

const std::vector<gid_t> ThreadScope::orig_groups = get_process_groups();

/**
 * set supplemental groups of the thread.
 * Groups are resolved in JavaScript (get_fs_context) with cache - similar to distinguished_name.
 * Logic: if supplemental_groups defined in account CLI use those; else if
 * NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS get from filesystem via SupplementalGroupsCache.
 * Native just applies the pre-resolved groups.
 */
static void
set_supplemental_groups(std::vector<gid_t>& groups) {
    if (groups.empty()) {
        MUST_SYS(syscall(SYS_setgroups, 0, NULL));
        return;
    }
    MUST_SYS(syscall(SYS_setgroups, groups.size(), &groups[0]));
}

/**
 * set the effective uid/gid/supplemental_groups of the current thread using direct syscalls
 * we have to bypass the libc wrappers because posix requires it to syncronize
 * uid, gid & supplemental_groups to all threads which is undesirable in our case.
 */
void
ThreadScope::change_user()
{
    if (_uid != orig_uid || _gid != orig_gid) {
        set_supplemental_groups(_groups);
        // must change gid first otherwise will fail on permission
        MUST_SYS(syscall(SYS_setresgid, -1, _gid, -1));
        MUST_SYS(syscall(SYS_setresuid, -1, _uid, -1));
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
        MUST_SYS(syscall(SYS_setresuid, -1, orig_uid, -1));
        MUST_SYS(syscall(SYS_setresgid, -1, orig_gid, -1));
        MUST_SYS(syscall(SYS_setgroups, orig_groups.size(), &orig_groups[0]));
    }
}

int
ThreadScope::add_thread_capabilities() {
    cap_t caps = cap_get_proc();
    cap_flag_value_t cap_flag_value;
    if(caps == NULL) {
        LOG("ThreadScope::set_thread_capabilities - cap_get_proc failed");
        return -1;
    }
    if(cap_get_flag(caps, CAP_DAC_READ_SEARCH, CAP_EFFECTIVE, &cap_flag_value) < 0) {
        LOG("ThreadScope::set_thread_capabilities - cap_get_flag failed");
        cap_free(caps);
        return -1;
    }
    if(cap_flag_value == CAP_SET) {
        LOG("ThreadScope::cap_flag_value - capability already exists");
        cap_free(caps);
        return 0;
    }
    cap_value_t newcaps[1] = { CAP_DAC_READ_SEARCH, };
    if(cap_set_flag(caps, CAP_EFFECTIVE, 1, newcaps, CAP_SET) < 0) {
        LOG("ThreadScope::set_thread_capabilities - cap_set_flag failed");
        cap_free(caps);
        return -1;
    }
    if(cap_set_proc(caps) < 0) {
        LOG("ThreadScope::set_thread_capabilities - cap_set_proc failed");
        cap_free(caps);
        return -1;
    }
    if(cap_free(caps) < 0) {
        LOG("cap_free failed");
    }
    return 0;
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
