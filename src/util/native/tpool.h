#ifndef TPOOL_H_
#define TPOOL_H_

#include <list>
#include "mutex.h"

class ThreadPool
{
public:
    explicit ThreadPool(int nthreads);
    virtual ~ThreadPool();
    struct WorkItem
    {
        virtual void run() = 0;
        virtual ~WorkItem() {}
    };
    void set_num_threads(int nthreads);
    void submit(WorkItem* item);
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
    static void thread_cb(void* arg);
    void thread_main(ThreadSpec& spec);
private:
    MutexCond _mutex;
    int _nthreads;
    std::list<WorkItem*> _queue;
};

#endif // TPOOL_H_
