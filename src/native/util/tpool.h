/* Copyright (C) 2016 NooBaa */
#pragma once

#include <list>

#include "common.h"
#include "mutex.h"
#include "nan.h"

namespace noobaa
{

class ThreadPool : public Nan::ObjectWrap
{
public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_GETTER(nthreads_getter);
    static NAN_SETTER(nthreads_setter);

public:
    /**
     * nthreads <= -1: use uv threadpool
     * nthreads == 0: no threads, run all inline in event loop thread
     * nthreads >= 1: create own threads
     */
    explicit ThreadPool(int nthreads);
    virtual ~ThreadPool();

    void set_nthreads(int nthreads);
    int get_nthreads() { return _nthreads; }

    struct Worker {
        virtual ~Worker() {}
        virtual void work() = 0; // called from pooled thread
        virtual void after_work() = 0; // called on event loop
    };
    void submit(Worker* worker);

private:
    struct ThreadSpec {
        ThreadPool* tpool;
        int index;
        ThreadSpec(ThreadPool* tp, int i)
            : tpool(tp)
            , index(i)
        {
        }
    };
    void thread_main(ThreadSpec& spec);
    void completion_cb();
    static void thread_main_uv(void* arg);
    static NAUV_WORK_CB(work_completed_uv);

private:
    MutexCond _mutex;
    int _nthreads;
    uv_async_t _async_completion;
    std::list<uv_thread_t> _thread_ids;
    std::list<Worker*> _pending_workers;
    std::list<Worker*> _completed_workers;
    int _refs;
};

} // namespace noobaa
