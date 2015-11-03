#ifndef NOOBAA__DEDUP_CHUNKER__H
#define NOOBAA__DEDUP_CHUNKER__H

#include "../util/common.h"
#include "../util/rabin_fingerprint.h"
#include "../util/tpool.h"
#include "dedup.h"
#include "dedup_config.h"

namespace noobaa {

/**
 *
 * DedupChunker
 *
 * Node.js object that performs variable length dedup.
 *
 */
class DedupChunker : public Nan::ObjectWrap
{
public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(push);
    static NAN_METHOD(flush);

private:
    explicit DedupChunker(DedupConfig* config)
        : _dedup_config(config)
        , _dedup_window(config->deduper)
        , _chunk_len(0)
    {
    }

    virtual ~DedupChunker()
    {
    }

private:
    class Worker;
    DedupConfig* _dedup_config;
    DedupConfig::Deduper::Window _dedup_window;
    std::list<Buf> _chunk_slices;
    int _chunk_len;
    Nan::Persistent<v8::Object> _config_persistent;
};

} // namespace noobaa

#endif // NOOBAA__DEDUP_CHUNKER__H
