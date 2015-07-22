#include "crypto.h"
#include "tpool.h"
#include "object_chunker.h"
#include "object_encoder.h"
#include "object_decoder.h"

static void
setup(v8::Handle<v8::Object> exports)
{
    Crypto::init();
    ThreadPool::setup(exports);
    ObjectChunker::setup(exports);
    ObjectEncoder::setup(exports);
    ObjectDecoder::setup(exports);
}

NODE_MODULE(native_util, setup)
