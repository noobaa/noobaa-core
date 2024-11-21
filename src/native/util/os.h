/* Copyright (C) 2016 NooBaa */
#pragma once

#include <sys/types.h>
#include <vector>
#include <string>

namespace noobaa
{

// see os_linux.cpp and os_darwin.cpp

pid_t get_current_tid();
uid_t get_current_uid();

/**
 * ThreadScope should be created on stack in a thread.
 * It provides accessor to os specific requests such as getting the thread id.
 * In addition it handles changing the thread uid & gid temporarily and restoring to original
 * when the operation scope ends.
 */
class ThreadScope
{
public:
    ThreadScope()
        : _uid(orig_uid)
        , _gid(orig_gid)
    {
    }

    ~ThreadScope()
    {
        restore_user();
    }

    void set_user(uid_t uid, gid_t gid, std::vector<gid_t>& groups)
    {
        _uid = uid;
        _gid = gid;
        _groups = groups;
        change_user();
    }

    int add_thread_capabilities();

    const static uid_t orig_uid;
    const static gid_t orig_gid;
    const static std::vector<gid_t> orig_groups;

    static std::vector<gid_t> get_process_groups();

private:
    void change_user();
    void restore_user();
    uid_t _uid;
    gid_t _gid;
    std::vector<gid_t> _groups;
};

} // namespace noobaa
