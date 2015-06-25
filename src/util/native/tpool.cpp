#include "tpool.h"

ThreadPool::ThreadPool(int nthreads)
    : _nthreads(0)
{
    set_num_threads(nthreads);
}

ThreadPool::~ThreadPool()
{
}

void ThreadPool::set_num_threads(int nthreads)
{
    MutexCond::Lock lock(_mutex);
    if (nthreads > _nthreads) {
        for (int i=_nthreads; i<nthreads; ++i) {
            uv_thread_t tid;
            uv_thread_create(
                &tid,
                &ThreadPool::thread_cb,
                new ThreadSpec(this, i));
        }
    }
    _nthreads = nthreads;
    _mutex.signal();
}

void ThreadPool::submit(ThreadPool::WorkItem* item)
{
    MutexCond::Lock lock(_mutex);
    _queue.push_back(item);
    _mutex.signal();
}

void ThreadPool::thread_cb(void* arg)
{
    ThreadSpec* spec = static_cast<ThreadSpec*>(arg);
    spec->tpool->thread_main(*spec);
    delete spec;
}

void ThreadPool::thread_main(ThreadPool::ThreadSpec& spec)
{
    int index = spec.index;

    while (true) {
        WorkItem* item = 0;

        // scope to unlock the mutex before running the work item
        {
            MutexCond::Lock lock(_mutex);
            if (index >= _nthreads) {
                break;
            }
            // wait for signal if no items
            while (_queue.empty()) {
                _mutex.wait();
            }
            item = _queue.front();
            _queue.pop_front();
        }

        // now running lockless

        if (!item) {
            continue;
        }

        try {
            item->run();
        } catch (const std::exception& ex) {
            std::cerr << "ThreadPool WorkItem exception " << ex.what() << std::endl;
        }

        try {
            delete item;
        } catch (...) {
        }
    }
}
