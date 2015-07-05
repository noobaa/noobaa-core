#include "tpool.h"
#include "backtrace.h"

void
tpool_thread_uv_cb(void* arg)
{
    ThreadPool::ThreadSpec* spec = static_cast<ThreadPool::ThreadSpec*>(arg);
    spec->tpool->thread_main(*spec);
    delete spec;
}

void
tpool_done_uv_cb(uv_async_t* async, int)
{
    ThreadPool* tpool = static_cast<ThreadPool*>(async->data);
    tpool->done_cb();
}

void atexit_cb()
{
    Backtrace bt;
    bt.print();
}

ThreadPool::ThreadPool(int nthreads)
    : _mutex()
    , _nthreads(0)
{
    set_num_threads(nthreads);
    uv_async_init(uv_default_loop(), &_async_notify_done, &tpool_done_uv_cb);
    // set the async handle to unreferenced (note that ref/unref is boolean, not counter)
    // so that it won't stop the event loop from finishing if it's the only handle left,
    // and submit() and done_cb() will ref/unref accordingly
    uv_unref(reinterpret_cast<uv_handle_t*>(&_async_notify_done));
    _async_notify_done.data = this;
    // atexit(atexit_cb);
}

ThreadPool::~ThreadPool()
{
    _nthreads = 0;
    while (!_thread_ids.empty()) {
        uv_thread_t tid = _thread_ids.front();
        _thread_ids.pop_front();
        uv_thread_join(&tid);
    }
    uv_close(reinterpret_cast<uv_handle_t*>(&_async_notify_done), NULL);
}

void
ThreadPool::set_num_threads(int nthreads)
{
    MutexCond::Lock lock(_mutex);
    if (nthreads > _nthreads) {
        for (int i=_nthreads; i<nthreads; ++i) {
            uv_thread_t tid;
            uv_thread_create(
                &tid,
                &tpool_thread_uv_cb,
                new ThreadSpec(this, i));
            _thread_ids.push_back(tid);
        }
    }
    _nthreads = nthreads;
    _mutex.signal();
}

void
ThreadPool::submit(ThreadPool::Job* job)
{
    MutexCond::Lock lock(_mutex);
    _run_queue.push_back(job);
    _mutex.signal();
    // see ctor comment on async handle
    uv_ref(reinterpret_cast<uv_handle_t*>(&_async_notify_done));
}

void
ThreadPool::thread_main(ThreadPool::ThreadSpec& spec)
{
    int index = spec.index;

    while (true) {
        Job* job = 0;

        // scope to unlock the mutex before running the job
        {
            MutexCond::Lock lock(_mutex);
            if (index >= _nthreads) {
                break;
            }
            // wait for signal if no items
            while (_run_queue.empty()) {
                _mutex.wait();
            }
            job = _run_queue.front();
            _run_queue.pop_front();
        }

        // now running lockless

        if (!job) {
            continue;
        }

        try {
            job->run();
        } catch (const std::exception& ex) {
            std::cerr << "ThreadPool Job exception " << ex.what() << std::endl;
        }

        {
            MutexCond::Lock lock(_mutex);
            _done_queue.push_back(job);
        }
        uv_async_send(&_async_notify_done);
    }
}

void
ThreadPool::done_cb()
{
    // under mutex we make copy of the list
    // to avoid recursive mutex locking which uv doesnt support cross platform
    std::list<Job*> local_done_queue;
    {
        MutexCond::Lock lock(_mutex);
        local_done_queue = _done_queue;
        _done_queue = std::list<Job*>();
        if (_run_queue.empty()) {
            // see ctor comment on async handle
            uv_unref(reinterpret_cast<uv_handle_t*>(&_async_notify_done));
        }
    }
    // call done() of each job not under mutex
    while (!local_done_queue.empty()) {
        Job* job = local_done_queue.front();
        local_done_queue.pop_front();
        job->done();
    }
}
