/* Copyright (C) 2016 NooBaa */
#include "tpool.h"

namespace noobaa
{

Nan::Persistent<v8::Function> ThreadPool::_ctor;

NAN_MODULE_INIT(ThreadPool::setup)
{
    auto name = "ThreadPool";
    auto tpl = Nan::New<v8::FunctionTemplate>(ThreadPool::new_instance);
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetAccessor(tpl->InstanceTemplate(), NAN_STR("nthreads"), &nthreads_getter, &nthreads_setter);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);
}

NAN_METHOD(ThreadPool::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    uint32_t nthreads = 0;
    if (!info[0]->IsUndefined()) {
        if (!info[0]->IsInt32()) {
            Nan::ThrowError("first argument should be number of threads");
        }
        nthreads = NAN_TO_INT(info[0]);
    }
    ThreadPool* obj = new ThreadPool(nthreads);
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
}

ThreadPool::ThreadPool(int nthreads)
    : _mutex()
    , _nthreads(0)
    , _refs(0)
{
    LOG("ThreadPool created with " << nthreads << " threads");
    set_nthreads(nthreads);

    // set the async handle to unreferenced (note that ref/unref is boolean, not counter)
    // so that it won't stop the event loop from finishing if it's the only handle left,
    // and submit() and completion_cb() will ref/unref accordingly
    uv_async_init(uv_default_loop(), &_async_completion, &work_completed_uv);
    uv_unref(reinterpret_cast<uv_handle_t*>(&_async_completion));
    _async_completion.data = this;
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
    for (int i = prev_nthreads; i < nthreads; ++i) {
        uv_thread_t tid;
        uv_thread_create(
            &tid,
            &thread_main_uv,
            new ThreadSpec(this, i));
        _thread_ids.push_back(tid);
    }
    _mutex.signal();
}

struct UvWorker {
    uv_work_t req;
    ThreadPool::Worker* worker;
    static void work(uv_work_t* req)
    {
        UvWorker* w = static_cast<UvWorker*>(req->data);
        w->worker->work();
    }
    static void after_work(uv_work_t* req, int status)
    {
        UvWorker* w = static_cast<UvWorker*>(req->data);
        w->worker->after_work();
        delete w;
    }
};

void
ThreadPool::submit(ThreadPool::Worker* worker)
{
    if (_nthreads > 0) {
        MutexCond::Lock lock(_mutex);
        if (_refs == 0) {
            // see ctor comment on async handle
            uv_ref(reinterpret_cast<uv_handle_t*>(&_async_completion));
        }
        _refs++;
        _pending_workers.push_back(worker);
        _mutex.signal();
    } else if (_nthreads < 0) {
        UvWorker* w = new UvWorker;
        w->worker = worker;
        w->req.data = w;
        uv_queue_work(uv_default_loop(), &w->req, &UvWorker::work, &UvWorker::after_work);
    } else {
        // fallback to direct call when 0 threads
        worker->work();
        worker->after_work();
    }
}

void
ThreadPool::thread_main(ThreadPool::ThreadSpec& spec)
{
    int index = spec.index;
    Worker* worker = 0;

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

NAN_GETTER(ThreadPool::nthreads_getter)
{
    ThreadPool& tpool = *NAN_UNWRAP_THIS(ThreadPool);
    NAN_RETURN(Nan::New<v8::Integer>(tpool.get_nthreads()));
}

NAN_SETTER(ThreadPool::nthreads_setter)
{
    ThreadPool& tpool = *NAN_UNWRAP_THIS(ThreadPool);
    tpool.set_nthreads(NAN_TO_INT(value));
}

void
ThreadPool::thread_main_uv(void* arg)
{
    ThreadPool::ThreadSpec* spec = static_cast<ThreadPool::ThreadSpec*>(arg);
    spec->tpool->thread_main(*spec);
    delete spec;
}

NAUV_WORK_CB(ThreadPool::work_completed_uv)
{
    ThreadPool* tpool = static_cast<ThreadPool*>(async->data);
    tpool->completion_cb();
}

} // namespace noobaa
