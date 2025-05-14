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

static int
get_supplemental_groups_by_uid(uid_t uid, std::vector<gid_t>& groups)
{
    const long passwd_buf_size = ThreadScope::get_passwd_buf_size();
    std::unique_ptr<char[]> buf(new char[passwd_buf_size]);
    struct passwd pwd;
    struct passwd *pw = NULL;

    const int res = getpwuid_r(uid, &pwd, buf.get(), passwd_buf_size, &pw);
    if (pw == NULL) {
        if (res == 0) {
            // LOG("get_supplemental_groups_by_uid: no record for uid " << uid);
        } else {
            LOG("WARNING: get_supplemental_groups_by_uid: getpwuid failed: " << strerror(errno));
        }
        return -1;
    }
    int ngroups = NGROUPS_MAX;
    groups.resize(ngroups);
    if (getgrouplist(pw->pw_name, pw->pw_gid, &groups[0], &ngroups) < 0) {
        LOG("get_supplemental_groups_by_uid: getgrouplist failed: ngroups too small " << ngroups);
        return -1;
    }
    groups.resize(ngroups);
    return 0;
}

/**
 * set supplemental groups of the thread according to the following:
 * 1. if groups were defined in the account configuration, set the groups list to the one defined
 * 2. try to get the list of groups corresponding to the user in the system recods, and set it to it
 * 3. if supplemental groups were not defined for the account and getting it from system record failed (either because record doesn't exist ot because of an error)
 *    set it to be an empty set
 */
static void
set_supplemental_groups(uid_t uid, std::vector<gid_t>& groups) {
    //first check if groups were defined in the account configuration
    if (groups.empty()) {
        const char* is_enabled = getenv("NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS");
        if ((is_enabled == NULL) || (strcmp(is_enabled, "true") != 0) || get_supplemental_groups_by_uid(uid, groups) < 0) {
            //couldn't get supplemental groups dynamically. set it to be an empty set
            MUST_SYS(syscall(SYS_setgroups, 0, NULL));
            return;
        }
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
        set_supplemental_groups(_uid, _groups);
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
