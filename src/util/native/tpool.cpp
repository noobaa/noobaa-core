#include "tpool.h"
#include "backtrace.h"

v8::Persistent<v8::Function> ThreadPool::_ctor;

void
ThreadPool::setup(v8::Handle<v8::Object> exports)
{
    auto name = "ThreadPool";
    auto tpl(NanNew<v8::FunctionTemplate>(ThreadPool::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    tpl->InstanceTemplate()->SetAccessor(NanNew("nthreads"), &nthreads_getter, &nthreads_setter);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(ThreadPool::new_instance)
{
    NanScope();
    uint32_t nthreads = 0;
    if (!args[0]->IsUndefined()) {
        if (!args[0]->IsInt32()) {
            NanThrowError("first argument should be number of threads");
        }
        nthreads = args[0]->Int32Value();
    }
    if (args.IsConstructCall()) {
        ThreadPool* obj = new ThreadPool(nthreads);
        obj->Wrap(args.This());
        NanReturnValue(args.This());
    } else {
        // Invoked as plain function call, turn into construct 'new' call.
        v8::Handle<v8::Value> argv[] = { args[0] };
        NanReturnValue(_ctor->NewInstance(1, argv));
    }
}

void atexit_cb()
{
    Backtrace bt;
    bt.print();
}

ThreadPool::ThreadPool(int nthreads)
    : _mutex()
    , _nthreads(0)
    , _refs(0)
{
    set_nthreads(nthreads);

    // set the async handle to unreferenced (note that ref/unref is boolean, not counter)
    // so that it won't stop the event loop from finishing if it's the only handle left,
    // and submit() and done_cb() will ref/unref accordingly
    uv_async_init(uv_default_loop(), &_async_done, &job_done_uv);
    uv_unref(reinterpret_cast<uv_handle_t*>(&_async_done));
    _async_done.data = this;

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
    uv_close(reinterpret_cast<uv_handle_t*>(&_async_done), NULL);
}

void
ThreadPool::set_nthreads(int nthreads)
{
    MutexCond::Lock lock(_mutex);
    if (nthreads > _nthreads) {
        for (int i=_nthreads; i<nthreads; ++i) {
            uv_thread_t tid;
            uv_thread_create(
                &tid,
                &thread_main_uv,
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
    if (_nthreads <= 0) {
        // fallback to direct call when 0 threads
        job->run();
        job->done();
    } else {
        MutexCond::Lock lock(_mutex);
        if (_refs == 0) {
            // see ctor comment on async handle
            uv_ref(reinterpret_cast<uv_handle_t*>(&_async_done));
        }
        _refs++;
        _run_queue.push_back(job);
        _mutex.signal();
    }
}

void
ThreadPool::thread_main(ThreadPool::ThreadSpec& spec)
{
    int index = spec.index;
    Job* job = 0;
    // std::cout << "Started Thread " << index << std::endl;

    while (true) {

        if (job) {
            // running lockless
            try {
                job->run();
            } catch (const std::exception& ex) {
                PANIC("ThreadPool Job run exception " << ex.what());
            }
        }

        // scope to unlock the mutex before accessing shared structures
        MutexCond::Lock lock(_mutex);

        if (job) {
            // push last job to done queue and notify the uv event loop to process the done queue
            _done_queue.push_back(job);
            job = 0;
            uv_async_send(&_async_done);
        }

        // wait for signal if no items
        // while waiting the mutex is released, but reacquired once wait returns
        while (index < _nthreads && _run_queue.empty()) {
            _mutex.wait();
        }
        if (index < _nthreads) {
            job = _run_queue.front();
            _run_queue.pop_front();
        }
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
        _refs -= local_done_queue.size();
        if (_refs == 0) {
            // see ctor comment on async handle
            uv_unref(reinterpret_cast<uv_handle_t*>(&_async_done));
        }
    }
    // call done() of each job not under mutex
    while (!local_done_queue.empty()) {
        Job* job = local_done_queue.front();
        local_done_queue.pop_front();
        try {
            job->done();
        } catch (const std::exception& ex) {
            PANIC("ThreadPool Job done exception " << ex.what());
        }
    }
}

NAN_ACCESSOR_GETTER(ThreadPool::nthreads_getter)
{
    ThreadPool& tpool = *ObjectWrap::Unwrap<ThreadPool>(info.This());
    return NanNew<v8::Integer>(tpool.get_nthreads());
}

NAN_ACCESSOR_SETTER(ThreadPool::nthreads_setter)
{
    ThreadPool& tpool = *ObjectWrap::Unwrap<ThreadPool>(info.This());
    tpool.set_nthreads(value->Int32Value());
}

void
ThreadPool::thread_main_uv(void* arg)
{
    ThreadPool::ThreadSpec* spec = static_cast<ThreadPool::ThreadSpec*>(arg);
    spec->tpool->thread_main(*spec);
    delete spec;
}

void
ThreadPool::job_done_uv(uv_async_t* async, int)
{
    ThreadPool* tpool = static_cast<ThreadPool*>(async->data);
    tpool->done_cb();
}
