/* Copyright (C) 2016 NooBaa */
#include "../util/common.h"
#include "../util/napi.h"
#include "../util/worker.h"
#include <cuda.h>

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

// About cuda context management:
// read this most helpful answer - https://forums.developer.nvidia.com/t/cuda-context-and-threading/26625/6
// Main points:
//  1) a context belongs to a single device.
//  2) a thread has a single context bound at a time (ignoring context stack stuff)
//  3) a context can be bound to multiple threads simultaneously
//
// Our threads need to set their cuda context, specifically the workers of cuobj_client_napi.
// For now we use only device 0 primary context and store it in a global variable for use by all threads.
// This means it will support one GPU per process, until we add support for multiple GPUs.
// Use env CUDA_VISIBLE_DEVICES to select the GPU to use - e.g. CUDA_VISIBLE_DEVICES=7
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

    extern CUcontext cuobj_client_napi_cuda_ctx;
    cuobj_client_napi_cuda_ctx = ctx;

    LOG("cuda_napi_ctx_init " << DVAL(dev_num) << DVAL(dev) << DVAL(ctx));
}

/**
 * Helper class for CudaMemory
 * Represents a slice of CUDA device memory that can be sub-sliced.
 */
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

/**
 * CudaMemory N-API ObjectWrap
 * Manages a chunk of CUDA device memory.
 */
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

/**
 * Returns a nodejs buffer that wraps cuda allocated memory.
 * This buffer cannot be used directly in javascript since the memory is on the device.
 * It can be used to pass to other native addons that understand cuda device pointers.
 * WARNING: The returned buffer is only valid while this CudaMemory instance is alive.
 * Do not use the buffer after calling free() or after this object is garbage collected.
 */
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

static void
cuda_mem_finalizer(Napi::Env, uint8_t* ptr)
{
    CUdeviceptr cuda_ptr = reinterpret_cast<CUdeviceptr>(ptr);
    CU_WARN(cuMemFree(cuda_ptr));
}

/**
 * NOTE: Use CudaMemory::as_buffer instead.
 * Returns a buffer that wraps cuda allocated memory.
 * Keeping this example of using CUDA Runtime APIs cudaMalloc/cudaFree,
 * compared to lower-level CUDA Device APIs cuMemAlloc/cuMemFree used in CudaMemory.
 */
Napi::Value
cudaMallocNapi(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    size_t size = info[0].As<Napi::Number>().Int64Value();
    CUdeviceptr cuda_ptr = 0;
    cuda_napi_ctx_init(env);
    CU_TRY(cuMemAlloc(&cuda_ptr, size));
    // set cuda info for being able to identify cuda buffers
    uint8_t* ptr = reinterpret_cast<uint8_t*>(cuda_ptr);
    char hex_ptr[2 * sizeof(ptr) + 1];
    snprintf(hex_ptr, sizeof(hex_ptr), "%016llx", cuda_ptr);
    auto cuda_info = Napi::Object::New(env);
    cuda_info.Set("ptr", Napi::String::New(env, hex_ptr));
    cuda_info.Set("dev", Napi::Number::New(env, cuda_napi_dev));
    cuda_info.Set("dev_num", Napi::Number::New(env, cuda_napi_dev_num));
    cuda_info.Freeze();
    auto buf = Napi::Buffer<uint8_t>::New(env, ptr, size, cuda_mem_finalizer);
    auto cuda_prop = Napi::PropertyDescriptor::Value("cuda", cuda_info, napi_enumerable);
    buf.DefineProperty(cuda_prop);
    return buf;
}

void
cuda_napi(Napi::Env env, Napi::Object exports)
{
    exports["CudaMemory"] = CudaMemory::Init(env);
    exports["cudaMalloc"] = Napi::Function::New(env, cudaMallocNapi);
    DBG0("CUDA: library loaded.");
}

} // namespace noobaa