/* Copyright (C) 2016 NooBaa */
#pragma once

#include <sys/types.h>

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

    void set_user(uid_t uid, gid_t gid)
    {
        _uid = uid;
        _gid = gid;
        change_user();
    }

    const static uid_t orig_uid;
    const static gid_t orig_gid;

private:
    void change_user();
    void restore_user();
    uid_t _uid;
    gid_t _gid;
};

} // namespace noobaa
