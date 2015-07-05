#ifndef TPOOL_H_
#define TPOOL_H_

#include "common.h"
#include "mutex.h"

class ThreadPool
{
public:
    explicit ThreadPool(int nthreads);
    virtual ~ThreadPool();
    struct Job
    {
        virtual ~Job() {}
        virtual void run() = 0; // called from pooled thread
        virtual void done() = 0; // called on event loop
    };
    void set_num_threads(int nthreads);
    void submit(Job* job);
private:
    struct ThreadSpec
    {
        ThreadPool* tpool;
        int index;
        ThreadSpec(ThreadPool* tp, int i)
            : tpool(tp)
            , index(i)
            {}
    };
    void thread_main(ThreadSpec& spec);
    void done_cb();
    friend void tpool_thread_uv_cb(void* arg);
    friend void tpool_done_uv_cb(uv_async_t* async, int);
private:
    MutexCond _mutex;
    int _nthreads;
    uv_async_t _async_notify_done;
    std::list<uv_thread_t> _thread_ids;
    std::list<Job*> _run_queue;
    std::list<Job*> _done_queue;
};

#endif // TPOOL_H_
