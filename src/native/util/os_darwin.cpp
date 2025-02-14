/* Copyright (C) 2016 NooBaa */
#ifdef __APPLE__

#include "common.h"
#include <sys/kauth.h> // for KAUTH_UID_NONE
#include <sys/param.h>
#include <unistd.h>
#include <algorithm>
#include <pwd.h>
#include <grp.h>

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

static int
get_supplemental_groups_by_uid(uid_t uid, std::vector<gid_t>& groups)
{
    // getpwuid will only indicate if an error happened by setting errno. set it to 0, so will know if there is a change
    errno = 0;
    struct passwd* pw = getpwuid(uid);
    if (pw == NULL) {
        if (errno == 0) {
            // LOG("get_supplemental_groups_by_uid: no record for uid " << uid);
        } else {
            LOG("WARNING: get_supplemental_groups_by_uid: getpwuid failed: " << strerror(errno));
        }
        return -1;
    }
    int ngroups = NGROUPS_MAX;
    //for some reason on mac getgrouplist accepts an array of int instead of gid_t. so need to create a vector of int and then insert it into groups
    std::vector<int> tmp_groups(ngroups);
    if (getgrouplist(pw->pw_name, pw->pw_gid, &tmp_groups[0], &ngroups) < 0) {
        LOG("get_supplemental_groups_by_uid: getgrouplist failed: ngroups too small " << ngroups);
        return -1;
    }
    groups.insert(groups.begin(), tmp_groups.begin(), tmp_groups.begin() + ngroups);
    return 0;
}

/**
 * set supplemental groups of the thread according to the following:
 * 1. if groups were defined in the account configuration, set the groups list to the one defined
 * 2. try to get the list of groups corresponding to the user in the system recods, and set it to it
 * 3. if supplemental groups were not defined for the account and getting it from system record failed (either because record doesn't exist ot because of an error)
 *    keep it as an empty set
 */
static void
set_supplemental_groups(uid_t uid, gid_t gid, std::vector<gid_t>& groups) {
    //first check if groups were defined in the account configuration
    if (groups.empty()) {
        const char* is_enabled = getenv("NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS");
        if ((is_enabled == NULL) || (strcmp(is_enabled, "true") != 0) || get_supplemental_groups_by_uid(uid, groups) < 0) {
            //aready unset by _mac_thread_setugid
            return;
        }
    }
    /*accourding to BSD Manual https://man.freebsd.org/cgi/man.cgi?query=setgroups
    which darwin is occasionally compliant to setgroups changes the effective gid according to
    the first element on the list. add the effective gid as the first element to prevent issues*/
    groups.push_back(gid);
    std::swap(groups.front(), groups.back());
    MUST_SYS(setgroups(groups.size(), &groups[0]));
}


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
        set_supplemental_groups(_uid, _gid, _groups);
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
