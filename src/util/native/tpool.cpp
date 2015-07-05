#include "tpool.h"

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

ThreadPool::ThreadPool(int nthreads)
    : _nthreads(0)
{
    set_num_threads(nthreads);
    uv_async_init(uv_default_loop(), &_async_notify_done, &tpool_done_uv_cb);
    uv_unref(reinterpret_cast<uv_handle_t*>(&_async_notify_done));
    _async_notify_done.data = this;
}

ThreadPool::~ThreadPool()
{
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
    MutexCond::Lock lock(_mutex);
    while (!_done_queue.empty()) {
        Job* job = _done_queue.front();
        _done_queue.pop_front();
        job->done();
    }
}
