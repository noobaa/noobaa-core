/* Copyright (C) 2016 NooBaa */
#include "../util/common.h"
#include "../util/napi.h"
#include "../util/worker.h"
#include "cuda.h"

#define CU_TRY(fn)                                    \
    do {                                              \
        CUresult r = fn;                              \
        if (r != CUDA_SUCCESS) {                      \
            const char* cuda_err = "";                \
            cuGetErrorName(r, &cuda_err);             \
            throw Napi::Error::New(env,               \
                XSTR() << __func__ << " " #fn " "     \
                       << DVAL(r) << DVAL(cuda_err)); \
        }                                             \
    } while (0)

#define CU_WARN(fn)                            \
    do {                                       \
        CUresult r = fn;                       \
        if (r != CUDA_SUCCESS) {               \
            const char* cuda_err = "";         \
            cuGetErrorName(r, &cuda_err);      \
            LOG("WARNING: "                    \
                << __func__ << " " #fn " "     \
                << DVAL(r) << DVAL(cuda_err)); \
        }                                      \
    } while (0)

#define CUDA_TRY(fn)                                    \
    do {                                                \
        cudaError_t r = fn;                             \
        if (r != cudaSuccess) {                         \
            const char* cuda_err = cudaGetErrorName(r); \
            throw Napi::Error::New(env,                 \
                XSTR() << __func__ << " " #fn " "       \
                       << DVAL(r) << DVAL(cuda_err));   \
        }                                               \
    } while (0)

namespace noobaa
{

DBG_INIT(1);

CUdevice cuda_napi_dev_num = -1;
CUdevice cuda_napi_dev = -1;
CUcontext cuda_napi_ctx = 0;

// About context management:
// read this most helpful answer - https://forums.developer.nvidia.com/t/cuda-context-and-threading/26625/6
// Main points:
//  1) a context belongs to a single device.
//  2) a thread has a single context bound at a time (ignoring context stack stuff)
//  3) a context can be bound to multiple threads simultaneously
// so we use the primary context on each device and bind it to our worker threads.
// in order to bind it we
static void
cuda_napi_ctx_init(Napi::Env env, int dev_num = 0)
{
    if (cuda_napi_dev_num == dev_num && cuda_napi_ctx) return;

    CUdevice dev = -1;
    CUcontext ctx = 0;

    CU_TRY(cuInit(0));
    CU_TRY(cuDeviceGet(&dev, dev_num));

    CU_TRY(cuDevicePrimaryCtxRetain(&ctx, dev));
    CU_TRY(cuCtxSetCurrent(ctx));

    cuda_napi_dev_num = dev_num;
    cuda_napi_dev = dev;
    cuda_napi_ctx = ctx;

    // rdma_napi needs worker threads to set the cuda context
    // and since we depend on rdma_napi we set the context here.
    extern CUcontext rdma_napi_cuda_ctx;
    rdma_napi_cuda_ctx = ctx;

    LOG("cuda_napi_ctx_init " << DVAL(dev_num) << DVAL(dev) << DVAL(ctx));
}

struct CudaSlice
{
    CUdeviceptr ptr;
    size_t size;

    CudaSlice slice(size_t start, size_t end)
    {
        if (start > size) start = size;
        if (end > size) end = size;
        if (end < start) end = start;
        return { ptr + start, end - start };
    }

    friend std::ostream&
    operator<<(std::ostream& os, CudaSlice& x)
    {
        return os << "[" << ((void*)x.ptr) << "+" << ((void*)x.size) << "]";
    }
};

struct CudaMemory : public Napi::ObjectWrap<CudaMemory>
{
    static Napi::FunctionReference constructor;
    CudaSlice mem;

    static Napi::Function Init(Napi::Env env);
    CudaMemory(const Napi::CallbackInfo& info);
    ~CudaMemory();
    Napi::Value free(const Napi::CallbackInfo& info);
    Napi::Value fill(const Napi::CallbackInfo& info);
    Napi::Value as_buffer(const Napi::CallbackInfo& info);
    Napi::Value copy_to_host_new(const Napi::CallbackInfo& info);
    Napi::Value copy_to_host(const Napi::CallbackInfo& info);
    Napi::Value copy_from_host(const Napi::CallbackInfo& info);
};

Napi::FunctionReference CudaMemory::constructor;

Napi::Function
CudaMemory::Init(Napi::Env env)
{
    constructor = Napi::Persistent(DefineClass(env,
        "CudaMemory",
        {
            InstanceMethod<&CudaMemory::free>("free"),
            InstanceMethod<&CudaMemory::fill>("fill"),
            InstanceMethod<&CudaMemory::as_buffer>("as_buffer"),
            InstanceMethod<&CudaMemory::copy_to_host_new>("copy_to_host_new"),
            InstanceMethod<&CudaMemory::copy_to_host>("copy_to_host"),
            InstanceMethod<&CudaMemory::copy_from_host>("copy_from_host"),
        }));
    constructor.SuppressDestruct();
    return constructor.Value();
}

CudaMemory::CudaMemory(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<CudaMemory>(info)
{
    auto env = info.Env();
    size_t size = info[0].As<Napi::Number>().Int64Value();
    CUdeviceptr ptr = 0;
    cuda_napi_ctx_init(env);
    CU_TRY(cuMemAlloc(&ptr, size));
    mem = { ptr, size };
    DBG1("CudaMemory::ctor " << DVAL(mem));
}

/**
 * On dtor free the memory and reset the pointer and size to 0.
 */
CudaMemory::~CudaMemory()
{
    if (mem.ptr) {
        auto free_mem = mem;
        mem = { 0, 0 };
        CU_WARN(cuMemFree(free_mem.ptr));
        DBG1("CudaMemory::dtor " << DVAL(free_mem));
    }
}

/**
 * Free the memory and reset the pointer and size to 0.
 */
Napi::Value
CudaMemory::free(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    if (mem.ptr) {
        auto free_mem = mem;
        mem = { 0, 0 };
        CU_TRY(cuMemFree(free_mem.ptr));
        DBG1("CudaMemory::free " << DVAL(free_mem));
    }
    return env.Undefined();
}

Napi::Value
CudaMemory::fill(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    uint32_t value = info[0].As<Napi::Number>().Uint32Value();
    size_t start = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 2 ? info[2].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    uint8_t byte = value & 0xff;
    CU_TRY(cuMemsetD8(slice.ptr, byte, slice.size));
    DBG1("CudaMemory::fill " << DVAL(mem) << DVAL(slice) << DVAL(byte));
    return Napi::Number::New(info.Env(), slice.size);
}

Napi::Value
CudaMemory::as_buffer(const Napi::CallbackInfo& info)
{
    size_t start = info.Length() > 0 ? info[0].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    auto buffer = Napi::Buffer<uint8_t>::New(info.Env(), (uint8_t*)slice.ptr, slice.size);
    DBG1("CudaMemory::as_buffer " << DVAL(mem) << DVAL(slice) << DBUF(buffer));
    return buffer;
}

Napi::Value
CudaMemory::copy_to_host_new(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    size_t start = info.Length() > 0 ? info[0].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    auto buffer = Napi::Buffer<uint8_t>::New(info.Env(), slice.size);
    CU_TRY(cuMemcpyDtoH(buffer.Data(), slice.ptr, slice.size));
    DBG1("CudaMemory::copy_to_host_new " << DVAL(mem) << DVAL(slice) << DVAL(buffer.Data()));
    return buffer;
}

Napi::Value
CudaMemory::copy_to_host(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    size_t start = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 2 ? info[2].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    size_t len = std::min(slice.size, buffer.Length());
    CU_TRY(cuMemcpyDtoH(buffer.Data(), slice.ptr, len));
    DBG1("CudaMemory::copy_to_host " << DVAL(mem) << DVAL(slice) << DBUF(buffer) << DVAL(len));
    return Napi::Number::New(info.Env(), len);
}

Napi::Value
CudaMemory::copy_from_host(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    size_t start = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 2 ? info[2].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    size_t len = std::min(slice.size, buffer.Length());
    CU_TRY(cuMemcpyHtoD(slice.ptr, buffer.Data(), len));
    DBG1("CudaMemory::copy_from_host " << DVAL(mem) << DVAL(slice) << DBUF(buffer) << DVAL(len));
    return Napi::Number::New(info.Env(), len);
}

/**
 *
 */
Napi::Value
cuda_malloc(const Napi::CallbackInfo& info)
{
#if USE_CUDA
    size_t size = info[0].As<Napi::Number>().Int64Value();
    // CUDA_TRY(cudaMemcpy(host_ptr, cuda_ptr, size, cudaMemcpyDeviceToHost));
    // CUDA_TRY(cudaMemcpy(cuda_ptr, host_ptr, size, cudaMemcpyHostToDevice));
    size_t size = info[0].As<Napi::Number>().Int64Value();
    void* cuda_ptr = 0;
    CUDA_TRY(cudaMalloc(&cuda_ptr, size));
    CUDA_TRY(cudaMemset(cuda_ptr, 'A', size));
    CUDA_TRY(cudaStreamSynchronize(0));
    cuObjMemoryType_t mem_type = cuObjClient::getMemoryType(cuda_ptr);
    LOG("cuda_malloc: " << DVAL(cuda_ptr) << DVAL(size) << DVAL(mem_type));

    auto finalizer = [](Napi::Env, uint8_t* ptr) { cudaFree(ptr); };
    auto buf = Napi::Buffer<uint8_t>::New(info.Env(), (uint8_t*)cuda_ptr, size, finalizer);
    return buf;
#else
    return info.Env().Undefined();
#endif
}

void
cuda_napi(Napi::Env env, Napi::Object exports)
{
    exports["CudaMemory"] = CudaMemory::Init(env);
    DBG0("CUDA: library loaded.");
}

} // namespace noobaa