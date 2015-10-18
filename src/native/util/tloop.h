#ifndef NOOBAA__TLOOP__H
#define NOOBAA__TLOOP__H

#include "common.h"
#include "mutex.h"

namespace noobaa {

/**
 * A thread running event loop.
 * This is like the opposite of a threadpool.
 * But unlike threadpool (tpool.h) the loop is usefull for I/O intensive tasks.
 */
class ThreadLoop
{
public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);

public:
    explicit ThreadLoop();
    virtual ~ThreadLoop();

    class Worker
    {
private:
        enum State { START, PENDING, WORKING, COMPLETED, DONE };
        State _state;
        ThreadLoop* _tloop;
public:
        Worker() : _state(START), _tloop(NULL)
        {
        }

        virtual ~Worker()
        {
        }

        // work() is called from loop thread
        // once async work completes it should call: this->callback()
        virtual void work() = 0;

        void callback();

        // after_loop() is called on default loop
        virtual void after_work() = 0;
    };

    void submit(Worker* worker);

    uv_loop_t* loop()
    {
        return &_loop;
    };

    void on_work_added();
    void on_work_completed();

private:
    static void thread_main_uv(void* arg);
    static NAUV_WORK_CB(work_added_uv);
    static NAUV_WORK_CB(work_completed_uv);

private:
    uv_loop_t _loop;
    uv_thread_t _tid;
    uv_async_t _async_loop;
    uv_async_t _async_completion;
    Mutex _mutex;
    std::list<Worker*> _pending_workers;
    std::list<Worker*> _completed_workers;
    int _refs;
};

} // namespace noobaa

#endif // NOOBAA__TLOOP__H
