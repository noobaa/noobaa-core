/* Copyright (C) 2016 NooBaa */
#pragma once

#include "napi.h"

namespace noobaa
{

/**
 * PromiseWorker is a base async worker that runs in a separate thread and
 * returns a promise. It makes sure to hold reference to keep the JS arguments
 * alive until the worker is done.
 * Inherit from this class and override Execute() to do the async work.
 * Override OnOK() to resolve the promise with the result.
 */
struct PromiseWorker : public Napi::AsyncWorker
{
    Napi::Promise::Deferred _promise;

    // keep refs to all the args/this for the worker lifetime.
    // this is needed mainly for workers that receive buffers,
    // and uses them to access the buffer memory.
    // these refs are released when the worker is deleted.
    Napi::ObjectReference _args_ref;
    Napi::Reference<Napi::Value> _this_ref;

    PromiseWorker(const Napi::CallbackInfo& info)
        : AsyncWorker(info.Env())
        , _promise(Napi::Promise::Deferred::New(info.Env()))
        , _args_ref(Napi::Persistent(Napi::Object::New(info.Env())))
        , _this_ref(Napi::Persistent(info.This()))
    {
        for (int i = 0; i < (int)info.Length(); ++i) _args_ref.Set(i, info[i]);
    }

    /**
     * This is a simple OnOK() that just resolves the promise with undefined.
     * However, most workers will needs to return a value that they compute
     * during Execute(), but Execute() runs in another thread and cannot access
     * JS objects. Instead, Execute() should keep native values/structures in
     * member variables, and override OnOK() to build the resulting JS value
     * and resolve the promise with it.
     */
    virtual void OnOK() override
    {
        // DBG1("PromiseWorker::OnOK: resolved (empty)");
        _promise.Resolve(Env().Undefined());
    }

    /**
     * Handle worker error by rejecting the promise with the error message.
     */
    virtual void OnError(Napi::Error const& error) override
    {
        LOG("PromiseWorker::OnError: " << DVAL(error.Message()));
        auto obj = error.Value();
        _promise.Reject(obj);
    }
};

/**
 * ObjectWrapWorker is a base class that simplifies adding async instance methods
 * to ObjectWrap types while keeping the object referenced during that action.
 */
template <typename ObjectWrapType>
struct ObjectWrapWorker : public PromiseWorker
{
    ObjectWrapType* _wrap;
    ObjectWrapWorker(const Napi::CallbackInfo& info)
        : PromiseWorker(info)
    {
        _wrap = ObjectWrapType::Unwrap(info.This().As<Napi::Object>());
        _wrap->Ref();
    }
    ~ObjectWrapWorker()
    {
        _wrap->Unref();
    }
};

/**
 * await_worker is a helper function to submit a PromiseWorker or ObjectWrapWorker
 * WorkerType should anyway be a subclass of PromiseWorker.
 */
template <typename WorkerType>
Napi::Value
await_worker(const Napi::CallbackInfo& info)
{
    PromiseWorker* worker = new WorkerType(info);
    Napi::Promise promise = worker->_promise.Promise();
    worker->Queue(); // this will delete the worker when done
    return promise;
}

} // namespace noobaa
