/*
Usage:
-----
CUDA_PATH="/usr/local/cuda"
CUOBJ_PATH="../cuObject-0.8.1-Linux_x86_64/src"
CUOBJ_LIBS="$CUOBJ_PATH/lib/libcuobjserver.so $CUOBJ_PATH/lib/libcuobjclient.so $CUOBJ_PATH/lib/libcufile.so.1.13.0 $CUOBJ_PATH/lib/libcufile_rdma.so.1.13.0"
g++ -o cudaguy cudaguy.cpp -I$CUDA_PATH/include/ -L$CUDA_PATH/lib64 -lcuda -I$CUOBJ_PATH/include/ $CUOBJ_LIBS
LD_PRELOAD=$CUOBJ_LIBS ./cudaguy
-----
*/

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cuobjclient.h"
#include "protocol.h"
#include <cuda.h>

#define CU_TRY(fn)                                                 \
    do {                                                           \
        CUresult r = fn;                                           \
        if (r != CUDA_SUCCESS) {                                   \
            const char* cuda_err = "";                             \
            cuGetErrorName(r, &cuda_err);                          \
            fprintf(stderr, "CUDA error: %s %s\n", cuda_err, #fn); \
            exit(1);                                               \
        }                                                          \
    } while (0)

ssize_t
cuobj_get(
    const void* handle,
    char* ptr,
    size_t size,
    loff_t offset,
    const cufileRDMAInfo_t* rdma_info)
{
    fprintf(stderr, "cuobj_get: handle %p ptr %p size %zu offset %ld\n", handle, ptr, size, offset);
    return size;
}

ssize_t
cuobj_put(
    const void* handle,
    const char* ptr,
    size_t size,
    loff_t offset,
    const cufileRDMAInfo_t* rdma_info)
{
    fprintf(stderr, "cuobj_put: handle %p ptr %p size %zu offset %ld\n", handle, ptr, size, offset);
    return size;
}

int
main()
{
    size_t size = 8 * 1024 * 1024;
    CUdevice cuda_device = 0;
    CUdevice cuda_device2 = 0;
    CUcontext cuda_ctx = 0;
    CUdeviceptr cuda_ptr = 0;
    CUmemorytype mem_type = CU_MEMORYTYPE_HOST;
    char* host_ptr = (char*)malloc(size);

    CU_TRY(cuInit(0));
    CU_TRY(cuDeviceGet(&cuda_device, 0););
    // CU_TRY(cuCtxCreate(&cuda_ctx, 0, cuda_device));
    CU_TRY(cuDevicePrimaryCtxRetain(&cuda_ctx, cuda_device));
    CU_TRY(cuCtxSetCurrent(cuda_ctx));
    fprintf(stderr, "CUDA initialized: device %d context %p\n", cuda_device, (void*)cuda_ctx);

    CU_TRY(cuCtxGetDevice(&cuda_device2));
    fprintf(stderr, "CUDA get device %d\n", cuda_device2);

    CU_TRY(cuMemAlloc(&cuda_ptr, size));
    CU_TRY(cuMemsetD8(cuda_ptr, 'A', size));
    CU_TRY(cuCtxSynchronize());
    fprintf(stderr, "CUDA allocated %p size %zu\n", (void*)cuda_ptr, size);

    CU_TRY(cuPointerGetAttribute(&mem_type, CU_POINTER_ATTRIBUTE_MEMORY_TYPE, cuda_ptr));
    fprintf(stderr, "CUDA buffer mem type: %d\n", mem_type);

    CUObjIOOps cuobj_ops = { .get = cuobj_get, .put = cuobj_put };
    cuObjClient cuobj_client(cuobj_ops);
    cuObjErr_t cuobj_err = cuobj_client.cuMemObjGetDescriptor((void*)cuda_ptr, size);
    fprintf(stderr, "cuObjClient::cuMemObjGetDescriptor: %d\n", cuobj_err);

    cuObjMemoryType_t cuobj_mem_type = cuObjClient::getMemoryType((void*)cuda_ptr);
    fprintf(stderr, "cuObjClient::getMemoryType: %d\n", cuobj_mem_type);

    ssize_t ret_size = cuobj_client.cuObjGet(NULL, (void*)cuda_ptr, size);
    fprintf(stderr, "cuObjClient::cuObjGet: %zd\n", ret_size);

    memset(host_ptr, 'B', size);
    CU_TRY(cuMemcpyDtoH(host_ptr, cuda_ptr, size));

    // skip repeating 'A' at the end, while keeping the first 10 chars,
    // and terminate the string for printing
    int i = size - 1;
    while (i > 10 && host_ptr[i] == 'A') --i;
    host_ptr[i] = '\0';
    fprintf(stderr, "CUDA copied to host: %s\n", host_ptr);

    free(host_ptr);
    CU_TRY(cuMemFree(cuda_ptr));
    CU_TRY(cuDevicePrimaryCtxRelease(cuda_device));
    // CU_TRY(cuCtxDestroy(cuda_ctx));
    fprintf(stderr, "CUDA freed\n");

    return 0;
}