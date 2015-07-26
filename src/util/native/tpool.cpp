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
    NAN_MAKE_CTOR_CALL(_ctor);
    uint32_t nthreads = 0;
    if (!args[0]->IsUndefined()) {
        if (!args[0]->IsInt32()) {
            NanThrowError("first argument should be number of threads");
        }
        nthreads = args[0]->Int32Value();
    }
    ThreadPool* obj = new ThreadPool(nthreads);
    obj->Wrap(args.This());
    NanReturnValue(args.This());
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
    // and submit() and completion_cb() will ref/unref accordingly
    uv_async_init(uv_default_loop(), &_async_completion, &work_completed_uv);
    uv_unref(reinterpret_cast<uv_handle_t*>(&_async_completion));
    _async_completion.data = this;

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
    uv_close(reinterpret_cast<uv_handle_t*>(&_async_completion), NULL);
}

void
ThreadPool::set_nthreads(int nthreads)
{
    MutexCond::Lock lock(_mutex);
    int prev_nthreads = _nthreads;
    _nthreads = nthreads;
    for (int i=prev_nthreads; i<nthreads; ++i) {
        uv_thread_t tid;
        uv_thread_create(
            &tid,
            &thread_main_uv,
            new ThreadSpec(this, i));
        _thread_ids.push_back(tid);
    }
    _mutex.signal();
}

void
ThreadPool::submit(ThreadPool::Worker* worker)
{
    if (_nthreads <= 0) {
        // fallback to direct call when 0 threads
        worker->work();
        worker->after_work();
    } else {
        MutexCond::Lock lock(_mutex);
        if (_refs == 0) {
            // see ctor comment on async handle
            uv_ref(reinterpret_cast<uv_handle_t*>(&_async_completion));
        }
        _refs++;
        _pending_workers.push_back(worker);
        _mutex.signal();
    }
}

void
ThreadPool::thread_main(ThreadPool::ThreadSpec& spec)
{
    int index = spec.index;
    Worker* worker = 0;
    // std::cout << "Started Thread " << index << std::endl;

    while (index < _nthreads) {

        if (worker) {
            // running lockless
            try {
                worker->work();
            } catch (const std::exception& ex) {
                PANIC("ThreadPool Worker work exception " << ex.what());
            }
        }

        // scope to unlock the mutex before accessing shared structures
        MutexCond::Lock lock(_mutex);

        if (worker) {
            // push last worker to done queue and notify the uv event loop to process the done queue
            _completed_workers.push_back(worker);
            worker = 0;
            uv_async_send(&_async_completion);
        }

        // wait for signal if no items
        // while waiting the mutex is released, and re-acquired before wait returns
        while (index < _nthreads && _pending_workers.empty()) {
            _mutex.wait();
        }
        if (index < _nthreads) {
            worker = _pending_workers.front();
            _pending_workers.pop_front();
        }
    }
}

void
ThreadPool::completion_cb()
{
    // under mutex we make copy of the list
    // to avoid recursive mutex locking which uv doesnt support cross platform
    std::list<Worker*> completed;
    {
        MutexCond::Lock lock(_mutex);
        completed = _completed_workers;
        _completed_workers = std::list<Worker*>();
        _refs -= completed.size();
        if (_refs == 0) {
            // see ctor comment on async handle
            uv_unref(reinterpret_cast<uv_handle_t*>(&_async_completion));
        }
    }
    // call after_work() of each worker not under mutex
    while (!completed.empty()) {
        Worker* worker = completed.front();
        completed.pop_front();
        try {
            worker->after_work();
        } catch (const std::exception& ex) {
            PANIC("ThreadPool Worker after_work exception " << ex.what());
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
ThreadPool::work_completed_uv(uv_async_t* async, int)
{
    ThreadPool* tpool = static_cast<ThreadPool*>(async->data);
    tpool->completion_cb();
}
