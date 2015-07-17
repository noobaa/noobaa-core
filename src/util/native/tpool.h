#ifndef TPOOL_H_
#define TPOOL_H_

#include "common.h"
#include "mutex.h"

class ThreadPool : public node::ObjectWrap
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
    void set_nthreads(int nthreads);
    int get_nthreads() { return _nthreads; }
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
    static void thread_main_uv(void* arg);
    static void job_done_uv(uv_async_t* async, int);
private:
    MutexCond _mutex;
    int _nthreads;
    uv_async_t _async_done;
    std::list<uv_thread_t> _thread_ids;
    std::list<Job*> _run_queue;
    std::list<Job*> _done_queue;
    int _refs;
public:
    static void setup(v8::Handle<v8::Object> exports);
private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_ACCESSOR_GETTER(nthreads_getter);
    static NAN_ACCESSOR_SETTER(nthreads_setter);
};

#endif // TPOOL_H_
