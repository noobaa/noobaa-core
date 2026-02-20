/* Copyright (C) 2016 NooBaa */
#include "../util/common.h"
#include "../util/napi.h"
#include "../util/worker.h"
#include <condition_variable>

// cuobj headers
typedef off_t loff_t;
#include <cuobjclient.h>
#include <protocol.h>

namespace noobaa
{

DBG_INIT(0);

typedef enum cuObjOpType_enum
{
    CUOBJ_GET = 0, /**< GET operation */
    CUOBJ_PUT = 1, /**< PUT operation */
    CUOBJ_INVALID = 9999
} cuObjOpType_t;

typedef Napi::External<struct iovec> ExternalIovec;

/**
 * CuObjClientNapi is a napi object wrapper for cuObjClient.
 */
struct CuObjClientNapi : public Napi::ObjectWrap<CuObjClientNapi>
{
    static Napi::FunctionReference constructor;
    std::shared_ptr<cuObjClient> _client;
    Napi::Reference<Napi::Symbol> _buffer_symbol;
    Napi::ThreadSafeFunction _thread_callback;

    static Napi::Function Init(Napi::Env env);
    CuObjClientNapi(const Napi::CallbackInfo& info);
    ~CuObjClientNapi();
    Napi::Value close(const Napi::CallbackInfo& info);
    Napi::Value register_buffer(const Napi::CallbackInfo& info);
    Napi::Value deregister_buffer(const Napi::CallbackInfo& info);
    Napi::Value is_registered_buffer(const Napi::CallbackInfo& info);
    Napi::Value rdma(const Napi::CallbackInfo& info);
};

/**
 * CuObjClientWorker is a napi worker for CuObjClientNapi::rdma()
 */
struct CuObjClientWorker : public ObjectWrapWorker<CuObjClientNapi>
{
    cuObjOpType_t _op_type;
    void* _ptr;
    size_t _size;
    std::string _rdma_desc;
    std::string _rdma_addr;
    size_t _rdma_size;
    loff_t _rdma_offset;
    bool _completed;
    ssize_t _ret_size;
    std::mutex _mutex;
    std::condition_variable _cond;
    Napi::FunctionReference _func;

    CuObjClientWorker(const Napi::CallbackInfo& info);
    virtual void Execute() override;
    virtual void OnOK() override;

    ssize_t start_op(
        cuObjOpType_t op_type,
        const void* handle,
        const void* ptr,
        size_t size,
        loff_t offset,
        const cufileRDMAInfo_t* rdma_info);
    void send_op(Napi::Env env);
};

Napi::FunctionReference CuObjClientNapi::constructor;

Napi::Function
CuObjClientNapi::Init(Napi::Env env)
{
    constructor = Napi::Persistent(DefineClass(env,
        "CuObjClientNapi",
        {
            InstanceMethod<&CuObjClientNapi::close>("close"),
            InstanceMethod<&CuObjClientNapi::register_buffer>("register_buffer"),
            InstanceMethod<&CuObjClientNapi::deregister_buffer>("deregister_buffer"),
            InstanceMethod<&CuObjClientNapi::is_registered_buffer>("is_registered_buffer"),
            InstanceMethod<&CuObjClientNapi::rdma>("rdma"),
        }));
    constructor.SuppressDestruct();
    return constructor.Value();
}

static ssize_t
get_op_fn(const void* handle, char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info)
{
    CuObjClientWorker* w = reinterpret_cast<CuObjClientWorker*>(cuObjClient::getCtx(handle));
    return w->start_op(CUOBJ_GET, handle, ptr, size, offset, rdma_info);
}

static ssize_t
put_op_fn(const void* handle, const char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info)
{
    CuObjClientWorker* w = reinterpret_cast<CuObjClientWorker*>(cuObjClient::getCtx(handle));
    return w->start_op(CUOBJ_PUT, handle, ptr, size, offset, rdma_info);
}

/**
 * Create a new CuObjClientNapi object wrapper.
 * There is not much to configure programmatically, but the client will load cufile.json
 * which is located by env var: CUFILE_ENV_PATH_JSON=/etc/cufile.json.
 * @see {@link https://docs.nvidia.com/gpudirect-storage/configuration-guide/index.html#gds-parameters}
 * @see {@link https://docs.nvidia.com/gpudirect-storage/api-reference-guide/index.html}
 *
 * Currently the client is synchronous and requires a callback to the main thread to send the http request.
 * This means that calling rdma() on the same client will add contention, and instead we should create
 * a separate client per each concurrent request. This is not a problem because the client is lightweight enough
 * but it is something to be aware of, and in the future we will prefer the library to be async.
 */
CuObjClientNapi::CuObjClientNapi(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<CuObjClientNapi>(info)
{
    DBG1("CuObjClientNapi::ctor");
    auto env = info.Env();

    uint32_t log_flags =
        // CUOBJ_LOG_PATH_DEBUG |
        // CUOBJ_LOG_PATH_INFO |
        CUOBJ_LOG_PATH_ERROR;

    cuObjClient::setupTelemetry(true, &std::cout);
    cuObjClient::setTelemFlags(log_flags);

    CUObjOps_t ops = {
        .get = &get_op_fn,
        .put = &put_op_fn,
    };
    std::shared_ptr<cuObjClient> client(new cuObjClient(ops, CUOBJ_PROTO_RDMA_DC_V1));

    if (!client->isConnected()) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjClientNapi::ctor connect failed (check rdma_dev_addr_list in cufile.json)");
    }

    // initialize a thread safe callback to the main thread
    // actual callback will be set in the worker
    auto noop = Napi::Function::New(env, [](const Napi::CallbackInfo& info) {});
    _thread_callback = Napi::ThreadSafeFunction::New(
        env, noop, "CuObjClientNapiThreadCallback", 0, 1, [](Napi::Env) {});

    _client = client;
    _buffer_symbol = Napi::Persistent(Napi::Symbol::New(env, "CuObjClientNapiBufferSymbol"));
}

CuObjClientNapi::~CuObjClientNapi()
{
    DBG1("CuObjClientNapi::dtor");
    _client.reset();
}

Napi::Value
CuObjClientNapi::close(const Napi::CallbackInfo& info)
{
    DBG0("CuObjClientNapi::close");
    _client.reset();
    return info.Env().Undefined();
}

/**
 * Register a buffer for RDMA.
 * No need to store the handle in the buffer as in the server side.
 * @param {Buffer} buf = info[0]
 */
Napi::Value
CuObjClientNapi::register_buffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    void* ptr = buf.Data();
    size_t size = buf.Length();

    cuObjErr_t ret_get_mem = _client->cuMemObjGetDescriptor(ptr, size);
    if (ret_get_mem != CU_OBJ_SUCCESS) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjClientNapi::register_buffer Failed to register rdma buffer "
                   << DVAL(ptr) << DVAL(size) << DVAL(ret_get_mem));
    }
    return env.Undefined();
}

/**
 * @param {Buffer} buf = info[0]
 */
Napi::Value
CuObjClientNapi::deregister_buffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    void* ptr = buf.Data();
    size_t size = buf.Length();

    cuObjErr_t ret_put_mem = _client->cuMemObjPutDescriptor(ptr);
    if (ret_put_mem != CU_OBJ_SUCCESS) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjClientNapi::deregister_buffer Failed to release rdma buffer "
                   << DVAL(ptr) << DVAL(size) << DVAL(ret_put_mem));
    }
    return env.Undefined();
}

/**
 * @param {Buffer} buf = info[0]
 * @returns {boolean}
 */
Napi::Value
CuObjClientNapi::is_registered_buffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    void* ptr = buf.Data();
    size_t size = buf.Length();

    const ssize_t max_size = _client->cuMemObjGetMaxRequestCallbackSize(ptr);
    if (max_size < static_cast<ssize_t>(size)) {
        return Napi::Boolean::New(env, false);
    }
    return Napi::Boolean::New(env, true);
}

/**
 * async function to start and await a CuObjClientWorker threadpool worker
 *
 * @param {'GET'|'PUT'} op_type = info[0]
 * @param {Buffer} client_buf = info[1]
 * @param {(rdma_info, callback) => void} func = info[2]
 * @returns {Promise<number>}
 */
Napi::Value
CuObjClientNapi::rdma(const Napi::CallbackInfo& info)
{
    return await_worker<CuObjClientWorker>(info);
}

CuObjClientWorker::CuObjClientWorker(const Napi::CallbackInfo& info)
    : ObjectWrapWorker<CuObjClientNapi>(info)
    , _op_type(CUOBJ_INVALID)
    , _ptr(0)
    , _size(0)
    , _rdma_size(0)
    , _rdma_offset(0)
    , _completed(false)
    , _ret_size(-1)
{
    auto op_type = info[0].As<Napi::String>().Utf8Value();
    auto buf = info[1].As<Napi::Buffer<uint8_t>>();
    auto func = info[2].As<Napi::Function>();

    if (op_type == "GET") {
        _op_type = CUOBJ_GET;
    } else if (op_type == "PUT") {
        _op_type = CUOBJ_PUT;
    } else {
        throw Napi::Error::New(info.Env(),
            XSTR() << "CuObjClientWorker: bad op type " << DVAL(op_type));
    }

    _ptr = buf.Data();
    _size = buf.Length();
    _func = Napi::Persistent(func);
}

// will be set by cuda_napi when loaded
CUcontext cuobj_client_napi_cuda_ctx = 0;

void
CuObjClientWorker::Execute()
{
    DBG1("CuObjClientWorker: Execute "
        << DVAL(_op_type)
        << DVAL(_ptr)
        << DVAL(_size));
    std::shared_ptr<cuObjClient> client(_wrap->_client);

    cuObjMemoryType_t mem_type = cuObjClient::getMemoryType(_ptr);
    DBG1("CuObjClientWorker: buffer " << DVAL(_ptr) << DVAL(_size) << DVAL(mem_type));

    // mem_type doesn't seem to identify the memory type correctly
    // so we need to set the context manually instead of this condition
    // mem_type == CUOBJ_MEMORY_CUDA_DEVICE || mem_type == CUOBJ_MEMORY_CUDA_MANAGED

    if (cuobj_client_napi_cuda_ctx) {
        CUresult res = cuCtxSetCurrent(cuobj_client_napi_cuda_ctx);
        if (res != CUDA_SUCCESS) {
            SetError(XSTR() << "CuObjClientWorker: Failed to set current context " << DVAL(res));
            return;
        }
    }

    // register rdma buffer if not already registered
    // caller should ideally register it beforehand, or deregister after use
    ssize_t max_size = client->cuMemObjGetMaxRequestCallbackSize(_ptr);
    if (max_size < static_cast<ssize_t>(_size)) {
        cuObjErr_t ret_get_mem = client->cuMemObjGetDescriptor(_ptr, _size);
        if (ret_get_mem != CU_OBJ_SUCCESS) {
            SetError(XSTR() << "CuObjClientWorker: Failed to register rdma buffer " << DVAL(ret_get_mem));
            return;
        }
    }

    if (_op_type == CUOBJ_GET) {
        _ret_size = client->cuObjGet(this, _ptr, _size);
    } else if (_op_type == CUOBJ_PUT) {
        _ret_size = client->cuObjPut(this, _ptr, _size);
    } else {
        PANIC("bad op type " << DVAL(_op_type));
    }

    if (_ret_size < 0 || _ret_size != ssize_t(_size)) {
        SetError(XSTR() << "CuObjClientWorker: failed "
                        << DVAL(_op_type) << DVAL(_ret_size));
    }
}

void
CuObjClientWorker::OnOK()
{
    _promise.Resolve(Napi::Number::New(Env(), _ret_size));
}

/**
 * Start an operation on the worker thread.
 */
ssize_t
CuObjClientWorker::start_op(
    cuObjOpType_t op_type,
    const void* handle,
    const void* ptr,
    size_t size,
    loff_t obj_offset,
    const cufileRDMAInfo_t* rdma_info)
{
    std::string rdma_desc(rdma_info->desc_str, rdma_info->desc_len - 1);
    DBG1("CuObjClientWorker::start_op " << DVAL(op_type) << DVAL(ptr) << DVAL(size) << DVAL(rdma_desc));

    // this lock and condition variable are used to synchronize the worker thread
    // with the main thread, as the main threas is sending the http request to the server.
    std::unique_lock lock(_mutex);

    // check that the parameters are as expected
    ASSERT(op_type == _op_type, DVAL(op_type) << DVAL(_op_type));
    ASSERT(ptr == _ptr, DVAL(ptr) << DVAL(_ptr));
    ASSERT(size == _size, DVAL(size) << DVAL(_size));
    ASSERT(obj_offset == 0, DVAL(obj_offset));

    // save info for the server request
    _rdma_desc = rdma_desc;
    _rdma_addr = XSTR() << std::hex << uintptr_t(ptr);
    _rdma_size = size;
    // obj_offset refers to the object offset, not the buffer offset
    _rdma_offset = 0;

    // send the op on the main thread by calling a Napi::ThreadSafeFunction.
    // this model is cumbwersome and would be replaced by an async worker in the future.
    // but for now the library requires us to make the http request sychronously from the worker thread,
    // so we need to send the op on the main thread and then wait for the worker to be woken up.
    _wrap->_thread_callback.Acquire();
    _wrap->_thread_callback.BlockingCall(
        [this](Napi::Env env, Napi::Function noop) {
            send_op(env);
        });
    _wrap->_thread_callback.Release();

    // after sending the op on main thread, the worker now waits for wakeup
    // guard using predicate and check for _completed because spurious wakeups 
    // can cause threads to wake without a notification causing undefined behavior.
    _cond.wait(lock, [this]{ return _completed; });
    lock.unlock();

    // _ret_size was set by the server response in the callback
    DBG1("CuObjClientWorker::start_op done " << DVAL(_ret_size));
    return _ret_size;
}

/**
 * Send the rdma_info to the server on the main thread.
 * When the server responds and the callback is called, the worker will be woken up.
 */
void
CuObjClientWorker::send_op(Napi::Env env)
{
    DBG1("CuObjClientWorker::send_op");
    Napi::HandleScope scope(env);

    auto rdma_info = Napi::Object::New(env);
    rdma_info["desc"] = Napi::String::New(env, _rdma_desc);
    rdma_info["addr"] = Napi::String::New(env, _rdma_addr);
    rdma_info["size"] = Napi::Number::New(env, _rdma_size);
    rdma_info["offset"] = Napi::Number::New(env, _rdma_offset);

    // prepare a node-style callback function(err, result)
    auto callback = Napi::Function::New(env, [this](const Napi::CallbackInfo& info) {
        // this lock can be problematic because it is on the main thread
        // but it works well if we a separate clients per each concurrent request
        // and then locking is immediate because at this point the worker is already waiting
        // on the condition and the mutex is free.
        std::unique_lock lock(_mutex);

        // setting _ret_size according to the server response
        // and waking up the worker to continue
        if (info[0].ToBoolean() || !info[1].IsNumber()) {
            _ret_size = -1;
        } else {
            _ret_size = info[1].As<Napi::Number>().Int64Value();
        }
        _completed = true;

        _cond.notify_one();
        lock.unlock();
    });

    // call the user provided function with the rdma_info and the callback
    // notice that we do not await here so the function must call the callback
    _func.Call({ rdma_info, callback });
}

void
cuobj_client_napi(Napi::Env env, Napi::Object exports)
{
    exports["CuObjClientNapi"] = CuObjClientNapi::Init(env);
    DBG0("CUOBJ: client library loaded.");
}

} // namespace noobaa
