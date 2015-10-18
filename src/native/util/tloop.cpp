#include "tloop.h"

namespace noobaa {

Nan::Persistent<v8::Function> ThreadLoop:_ctor;

NAN_MODULE_INIT(ThreadLoop::setup)
{
    auto name = "ThreadLoop";
    auto tpl = Nan::New<v8::FunctionTemplate>(ThreadLoop::new_instance);
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);
}

NAN_METHOD(ThreadLoop::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    ThreadLoop* obj = new ThreadLoop();
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
}

ThreadLoop::ThreadLoop()
    : _mutex()
    , _refs(0)
{
    LOG("ThreadLoop::ThreadLoop");
    uv_loop_init(&_loop);
    uv_async_init(&_loop, &_async_loop, &work_added_uv);
    uv_async_init(uv_default_loop(), &_async_completion, &work_completed_uv);
    _async_loop.data = this;
    _async_completion.data = this;
    // set the async handle to unreferenced (note that ref/unref is boolean, not counter)
    // so that it won't stop the event loop from finishing if it's the only handle left,
    // and submit() and on_work_completed() will ref/unref accordingly
    uv_unref(reinterpret_cast<uv_handle_t*>(&_async_completion));
    uv_thread_create(&_tid, &thread_main_uv, this);
}

ThreadLoop::~ThreadLoop()
{
    // TODO currently we do not support destruction.
    // if we do then need a notification to pending workers.
    uv_thread_join(&_tid);
    uv_close(reinterpret_cast<uv_handle_t*>(&_async_loop), NULL);
    uv_close(reinterpret_cast<uv_handle_t*>(&_async_completion), NULL);
}

void
ThreadLoop::thread_main_uv(void* arg)
{
    ThreadLoop* tloop = reinterpret_cast<ThreadLoop*>(arg);
    uv_run(&tloop->_loop, UV_RUN_DEFAULT);
}

void
ThreadLoop::submit(Worker* worker)
{
    assert(!worker->_tloop);
    assert(worker->_state == Worker::State::START);
    worker->_tloop = this;
    worker->_state = Worker::State::PENDING;
    Mutex::Lock lock(_mutex);
    _pending_workers.push_back(worker);
    if (_refs == 0) {
        // see ctor comment on async handle
        uv_ref(reinterpret_cast<uv_handle_t*>(&_async_completion));
    }
    _refs++;
    lock.unlock();
    uv_async_send(&_async_loop);
}

NAUV_WORK_CB(ThreadLoop::work_added_uv)
{
    ThreadLoop* tloop = static_cast<ThreadLoop*>(async->data);
    tloop->on_work_added();
}

void
ThreadLoop::on_work_added()
{
    std::list<Worker*> pending;
    {
        Mutex::Lock lock(_mutex);
        pending = _pending_workers;
        _pending_workers = std::list<Worker*>();
    }
    // call work() of each worker not under mutex
    while (!pending.empty()) {
        Worker* worker = pending.front();
        pending.pop_front();
        assert(worker->_tloop == tloop);
        assert(worker->_state == Worker::State::PENDING);
        worker->_state = Worker::State::WORKING;
        try {
            worker->work();
        } catch (const std::exception& ex) {
            PANIC("ThreadLoop Worker work exception " << ex.what());
        }
    }
}

void
ThreadLoop::Worker::callback()
{
    assert(worker->_tloop);
    assert(worker->_state == Worker::State::WORKING);
    worker->_state = Worker::State::COMPLETED;
    Mutex::Lock lock(_mutex);
    _completed_workers.push_back(worker);
    lock.unlock();
    uv_async_send(&_async_completion);
}

NAUV_WORK_CB(ThreadLoop::work_completed_uv)
{
    ThreadLoop* tloop = static_cast<ThreadLoop*>(async->data);
    tloop->on_work_completed();
}

void
ThreadLoop::on_work_completed()
{
    std::list<Worker*> completed;
    {
        Mutex::Lock lock(_mutex);
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
        assert(worker->_tloop == tloop);
        assert(worker->_state == Worker::State::COMPLETED);
        worker->_state = Worker::State::DONE;
        try {
            worker->after_work();
        } catch (const std::exception& ex) {
            PANIC("ThreadLoop Worker after_work exception " << ex.what());
        }
    }
}
