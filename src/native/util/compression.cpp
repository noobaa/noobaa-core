#include "compression.h"
#include "../snappy/snappy.h"
#include "../snappy/snappy-sinksource.h"
#include <zlib.h>

class BufSink : public snappy::Sink
{
public:
    explicit BufSink() : _len(0)
    {
    }
    virtual ~BufSink()
    {
    }
    /**
     * once all is appended we can concat (copyfull!)
     */
    Buf concat()
    {
        return Buf(_len, _bufs.begin(), _bufs.end());
    }
    int length()
    {
        return _len;
    }
    virtual void Append(const char* data, size_t n_)
    {
        int n = static_cast<int>(n_);
        if (!_bufs.empty() && _bufs.back().cdata() == data) {
            // data pointer was returned from GetAppendBuffer
            // LOG("BufSink::Append using back buffer "
                // << DVAL(n) << DVAL(_bufs.back().length()) << DVAL(_len) << DVAL(_bufs.size()));
            assert(_bufs.back().length() >= n);
            _bufs.back().slice(0, n);
        } else {
            // LOG("BufSink::Append adding buffer "
                // << DVAL(n) << DVAL(_len) << DVAL(_bufs.size()));
            Buf buf(n);
            memcpy(buf.data(), data, n);
            _bufs.push_back(buf);
        }
        _len += n;
    }
    virtual char* GetAppendBuffer(size_t len, char* scratch)
    {
        // LOG("BufSink::GetAppendBuffer "
            // << DVAL(len) << DVAL(_len) << DVAL(_bufs.size()));
        Buf append(len);
        _bufs.push_back(append);
        return append.cdata();
    }
    virtual char* GetAppendBufferVariable(
        size_t min_size, size_t desired_size_hint, char* scratch,
        size_t scratch_size, size_t* allocated_size)
    {
        // LOG("BufSink::GetAppendBufferVariable "
            // << DVAL(scratch_size) << DVAL(_len) << DVAL(_bufs.size()));
        *allocated_size = scratch_size;
        return scratch;
    }
    virtual void AppendAndTakeOwnership(
        char* bytes, size_t n,
        void (*deleter)(void*, const char*, size_t),
        void *deleter_arg)
    {
        // LOG("BufSink::AppendAndTakeOwnership "
            // << DVAL(n) << DVAL(_len) << DVAL(_bufs.size()));
        Append(bytes, n);
        (*deleter)(deleter_arg, bytes, n);
    }
private:
    int _len;
    std::list<Buf> _bufs;
};

Buf
Compression::compress(Buf buf, std::string type)
{
    if (type == "snappy") {
        snappy::ByteArraySource source(buf.cdata(), buf.length());
        BufSink sink;
        size_t compressed_len = snappy::Compress(&source, &sink);
        Buf compressed = sink.concat();
        // LOG("Compression::compress " << DVAL(buf.length()) << DVAL(compressed_len));
        assert(compressed.length() == static_cast<int>(compressed_len));
        return compressed;
        // TODO } else if (type == "zlib") {
    } else {
        ASSERT(type.empty(), "Compression type not supported " << type);
        return Buf();
    }
}

Buf
Compression::decompress(Buf buf, std::string type)
{
    if (type == "snappy") {
        snappy::ByteArraySource source(buf.cdata(), buf.length());
        BufSink sink;
        bool ok = snappy::Uncompress(&source, &sink);
        // LOG("Compression::decompress " << DVAL(buf.length()) << DVAL(sink.length()));
        ASSERT(ok, "SNAPPY: decompress failed on corrupted buffer");
        Buf decompressed = sink.concat();
        return decompressed;
        // TODO } else if (type == "zlib") {
    } else {
        ASSERT(type.empty(), "Compression type not supported " << type);
        return Buf();
    }
}
