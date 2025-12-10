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
    Napi::ThreadSafeFunction _thread_callback;

    static Napi::Function Init(Napi::Env env);
    CuObjClientNapi(const Napi::CallbackInfo& info);
    ~CuObjClientNapi();
    Napi::Value close(const Napi::CallbackInfo& info);
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

/**
 * @brief Defines the JavaScript class "CuObjClientNapi" and returns its constructor.
 *
 * Creates and persists the N-API constructor for the native CuObjClientNapi class,
 * including its instance methods `close` and `rdma`, and returns the constructor function.
 *
 * @param env The N-API environment used to create the class.
 * @return Napi::Function The JavaScript constructor function for `CuObjClientNapi`.
 */
Napi::Function
CuObjClientNapi::Init(Napi::Env env)
{
    constructor = Napi::Persistent(DefineClass(env,
        "CuObjClientNapi",
        {
            InstanceMethod<&CuObjClientNapi::close>("close"),
            InstanceMethod<&CuObjClientNapi::rdma>("rdma"),
        }));
    constructor.SuppressDestruct();
    return constructor.Value();
}

/**
 * @brief Start a CUOBJ GET operation for the context identified by `handle`.
 *
 * Initiates a GET operation that reads up to `size` bytes into `ptr` from the
 * remote object at `offset`, using the optional RDMA parameters in `rdma_info`.
 *
 * @param handle Opaque context handle identifying the operation context.
 * @param ptr Destination buffer for received data.
 * @param size Maximum number of bytes to read into `ptr`.
 * @param offset Byte offset within the remote object to begin the read.
 * @param rdma_info Optional RDMA descriptor and address/size/offset; may be null.
 * @return ssize_t Number of bytes read on success, or a negative error code on failure.
 */
static ssize_t
get_op_fn(const void* handle, char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info)
{
    CuObjClientWorker* w = reinterpret_cast<CuObjClientWorker*>(cuObjClient::getCtx(handle));
    return w->start_op(CUOBJ_GET, handle, ptr, size, offset, rdma_info);
}

/**
 * @brief Initiates a PUT RDMA operation for the client context identified by `handle`.
 *
 * @param handle Opaque client context handle identifying the target CuObjClientWorker.
 * @param ptr Pointer to the source buffer containing data to PUT.
 * @param size Number of bytes available in `ptr` to transfer.
 * @param offset Offset within the remote object where data should be written.
 * @param rdma_info Optional RDMA metadata (description, address, size, offset) used for the transfer; may be null.
 * @return ssize_t Number of bytes transferred on success, or a negative error code on failure.
 */
static ssize_t
put_op_fn(const void* handle, const char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info)
{
    CuObjClientWorker* w = reinterpret_cast<CuObjClientWorker*>(cuObjClient::getCtx(handle));
    return w->start_op(CUOBJ_PUT, handle, ptr, size, offset, rdma_info);
}

/**
 * @brief Constructs a CuObjClientNapi wrapper and initializes the underlying cuObjClient.
 *
 * Loads cuObjClient configuration (for example, cufile.json located via CUFILE_ENV_PATH_JSON),
 * enables telemetry/logging, creates a cuObjClient configured for RDMA, and initializes a
 * ThreadSafeFunction used to dispatch callbacks to the main thread.
 *
 * @note The underlying cuObjClient performs synchronous operations and relies on a main-thread
 * callback to send the HTTP/RDMA request. For concurrent operations prefer creating a separate
 * client per concurrent request to avoid contention.
 *
 * @throws Napi::Error If the underlying cuObjClient fails to connect (for example due to invalid
 *                     RDMA configuration in the cufile.json).
 */
CuObjClientNapi::CuObjClientNapi(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<CuObjClientNapi>(info)
{
    DBG0("CuObjClientNapi::ctor");

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
        throw Napi::Error::New(info.Env(),
            XSTR() << "CuObjClientNapi::ctor connect failed (check rdma_dev_addr_list in cufile.json)");
    }

    // initialize a thread safe callback to the main thread
    // actual callback will be set in the worker
    auto noop = Napi::Function::New(
        info.Env(), [](const Napi::CallbackInfo& info) {});
    _thread_callback = Napi::ThreadSafeFunction::New(
        info.Env(), noop, "CuObjClientNapiThreadCallback", 0, 1, [](Napi::Env) {});

    _client = client;
}

/**
 * @brief Destroy the CuObjClientNapi instance and release its resources.
 *
 * Resets the owned cuObjClient shared pointer to release the underlying client
 * connection and associated resources.
 */
CuObjClientNapi::~CuObjClientNapi()
{
    DBG0("CuObjClientNapi::dtor");
    _client.reset();
}

/**
 * @brief Releases the wrapped cuObjClient instance and frees associated resources.
 *
 * @return Napi::Value JavaScript `undefined`.
 */
Napi::Value
CuObjClientNapi::close(const Napi::CallbackInfo& info)
{
    DBG0("CuObjClientNapi::close");
    _client.reset();
    return info.Env().Undefined();
}

/**
 * @brief Initiates an RDMA GET or PUT operation using a CuObjClientWorker.
 *
 * Starts a worker that performs the requested RDMA operation and invokes the
 * provided JavaScript callback to complete the server-side part of the transfer.
 *
 * @param op_type Operation type: either "GET" to read into `buf` or "PUT" to write from `buf`.
 * @param buf Buffer whose memory will be used for the RDMA transfer.
 * @param func JavaScript function called on the main thread with RDMA info and a node-style callback
 *             to report completion: func(rdma_info, (err, size) => void).
 * @return long The number of bytes transferred on success, or a negative error code on failure.
 */
Napi::Value
CuObjClientNapi::rdma(const Napi::CallbackInfo& info)
{
    return await_worker<CuObjClientWorker>(info);
}

/**
 * @brief Construct a CuObjClientWorker from JavaScript arguments.
 *
 * Initializes the worker's operation type, buffer pointer/length, and persists
 * the JavaScript callback based on the supplied CallbackInfo.
 *
 * @param info JavaScript call arguments: expects
 *   - index 0: a string with value "GET" or "PUT" to select the operation;
 *   - index 1: a Buffer containing the data for the operation;
 *   - index 2: a callback function to be invoked when the main-thread RDMA
 *     exchange completes.
 *
 * @throws Napi::Error if the operation type is not "GET" or "PUT".
 */
CuObjClientWorker::CuObjClientWorker(const Napi::CallbackInfo& info)
    : ObjectWrapWorker<CuObjClientNapi>(info)
    , _op_type(CUOBJ_INVALID)
    , _ptr(0)
    , _size(0)
    , _rdma_size(0)
    , _rdma_offset(0)
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

/**
 * @brief Execute the worker's RDMA operation (GET or PUT) using the wrapped cuObjClient.
 *
 * Executes the operation indicated by the worker's `_op_type` against the buffer (`_ptr`, `_size`)
 * through the wrapped `cuObjClient`. If a global CUDA context is configured, the context is set
 * before performing the operation. On successful completion the transferred byte count is stored
 * in `_ret_size`. On failure the worker records an error via `SetError`. An invalid `_op_type`
 * triggers a fatal panic.
 */
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

    // register rdma buffer
    // cuObjErr_t ret_get_mem = client->cuMemObjGetDescriptor(_ptr, _size);
    // if (ret_get_mem != CU_OBJ_SUCCESS) {
    //     SetError(XSTR() << "CuObjClientWorker: Failed to register rdma buffer " << DVAL(ret_get_mem));
    //     return;
    // }
    // StackCleaner cleaner([&] {
    //     // release rdma buffer
    //     cuObjErr_t ret_put_mem = client->cuMemObjPutDescriptor(_ptr);
    //     if (ret_put_mem != CU_OBJ_SUCCESS) {
    //         SetError(XSTR() << "CuObjClientWorker: Failed to release rdma buffer " << DVAL(ret_put_mem));
    //     }
    // });

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

/**
 * @brief Deliver the operation result to JavaScript.
 *
 * Resolves the worker's pending promise with `_ret_size` converted to a JavaScript
 * Number representing the number of bytes transferred by the RDMA operation.
 */
void
CuObjClientWorker::OnOK()
{
    _promise.Resolve(Napi::Number::New(Env(), _ret_size));
}

/**
 * @brief Dispatches an RDMA GET or PUT operation to the main thread and waits for the server response.
 *
 * Sends operation metadata to the main thread via the thread-safe callback, blocks until the operation
 * completes, and returns the result reported by the server.
 *
 * @param op_type Operation type (`CUOBJ_GET` or `CUOBJ_PUT`).
 * @param handle Opaque handle associated with the operation context.
 * @param ptr Pointer to the buffer involved in the operation.
 * @param size Size of the buffer in bytes.
 * @param obj_offset Offset within the remote object (object offset, not buffer offset). Must be zero in current usage.
 * @param rdma_info RDMA descriptor containing connection/registration details used to build the request.
 * @return ssize_t Number of bytes transferred on success, or a negative error code on failure.
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
    _cond.wait(lock);
    lock.unlock();

    // _ret_size was set by the server response in the callback
    DBG1("CuObjClientWorker::start_op done " << DVAL(_ret_size));
    return _ret_size;
}

/**
 * @brief Dispatches RDMA operation details to the main thread and registers a response callback.
 *
 * Constructs a JavaScript object containing `desc`, `addr`, `size`, and `offset`, then invokes the user-provided
 * JavaScript function with that object and a node-style callback. When the callback is invoked by the JavaScript
 * caller, it stores the server result in `_ret_size` (`-1` on error) while holding the worker mutex and notifies
 * the worker's condition variable so the worker can resume.
 *
 * @param env N-API environment used to create JavaScript values and functions.
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

        _cond.notify_one();
        lock.unlock();
    });

    // call the user provided function with the rdma_info and the callback
    // notice that we do not await here so the function must call the callback
    _func.Call({ rdma_info, callback });
}

/**
 * @brief Registers the CuObjClientNapi class on the provided N-API module exports.
 *
 * Attaches the CuObjClientNapi constructor to the given exports object so the class
 * becomes available to JavaScript code that imports the native addon.
 *
 * @param env The N-API environment for the current module initialization.
 * @param exports The module exports object where `CuObjClientNapi` will be assigned.
 */
void
cuobj_client_napi(Napi::Env env, Napi::Object exports)
{
    exports["CuObjClientNapi"] = CuObjClientNapi::Init(env);
    DBG0("CUOBJ: client library loaded.");
}

} // namespace noobaa