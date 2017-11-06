/* Copyright (C) 2016 NooBaa */
#include "compression.h"

#include <list>

#include <zlib.h>

#include "../third_party/snappy/snappy-sinksource.h"
#include "../third_party/snappy/snappy.h"

namespace noobaa
{

/**
 *
 * A Sink implementation that appends buffers as much as needed.
 *
 */
class BufSink : public snappy::Sink
{
public:
    /**
     * alloc_size is the buffer size to preallocate for appending
     */
    explicit BufSink(int alloc_size)
        : _alloc_size(alloc_size)
        , _alloc_offset(0)
        , _len(0)
    {
    }
    Buf get_buffer()
    {
        if (_bufs.empty()) {
            // copyless :)
            return Buf(_alloc, 0, _alloc_offset);
        } else {
            // copyful :(
            _bufs.push_back(Buf(_alloc, 0, _alloc_offset));
            return Buf(_len, _bufs.begin(), _bufs.end());
        }
    }
    virtual char* GetAppendBuffer(size_t len_, char* scratch)
    {
        int len = static_cast<int>(len_);
        // LOG("BufSink::GetAppendBuffer "
        // << DVAL(len) << DVAL(_alloc_offset)
        // << DVAL(_alloc.length()) << DVAL(_len));
        if (_alloc_offset + len > _alloc.length()) {
            if (_alloc_offset > 0) {
                _alloc.slice(0, _alloc_offset);
                _bufs.push_back(_alloc);
            }
            _alloc_offset = 0;
            _alloc = Buf(len > _alloc_size ? len : _alloc_size);
            // LOG("BufSink::GetAppendBuffer allocated " << _alloc.length());
        }
        return _alloc.cdata() + _alloc_offset;
    }
    virtual void Append(const char* data, size_t n_)
    {
        int n = static_cast<int>(n_);
        // LOG("BufSink::Append "
        // << DVAL(n) << DVAL(_alloc_offset)
        // << DVAL(_alloc.length()) << DVAL(_len));
        if (_alloc.cdata() + _alloc_offset != data) {
            // data pointer was returned from GetAppendBuffer
            char* dest = GetAppendBuffer(n, 0);
            memcpy(dest, data, n);
            // LOG("BufSink::Append copy");
        }
        _alloc_offset += n;
        _len += n;
    }

private:
    int _alloc_size;
    int _alloc_offset;
    Buf _alloc;
    std::list<Buf> _bufs;
    int _len;
};

/**
 *
 * A Sink implementation that writes to a flat array with bound checks.
 *
 */
class CheckedByteArraySink : public snappy::Sink
{
public:
    explicit CheckedByteArraySink(char* dest, int len)
        : _dest(dest)
        , _len(len)
    {
    }
    int get_remaining_bytes()
    {
        return _len;
    }
    void throw_if_exhausted(size_t n)
    {
        if (_len < static_cast<int>(n)) {
            throw Exception("SNAPPY SINK EXHAUSTED");
        }
    }
    virtual char* GetAppendBuffer(size_t len, char* scratch)
    {
        throw_if_exhausted(len);
        return _dest;
    }
    virtual void Append(const char* data, size_t n)
    {
        // Do no copying if the caller filled in the result of GetAppendBuffer()
        throw_if_exhausted(n);
        if (data != _dest) {
            memcpy(_dest, data, n);
        }
        _dest += n;
        _len -= n;
    }
    virtual char* GetAppendBufferVariable(
        size_t min_size, size_t desired_size_hint, char* scratch, size_t scratch_size, size_t* allocated_size)
    {
        throw_if_exhausted(min_size);
        *allocated_size =
            _len < static_cast<int>(desired_size_hint)
            ? static_cast<size_t>(_len)
            : desired_size_hint;
        return _dest;
    }
    virtual void AppendAndTakeOwnership(
        char* data, size_t n, void (*deleter)(void*, const char*, size_t), void* deleter_arg)
    {
        throw_if_exhausted(n);
        if (data != _dest) {
            memcpy(_dest, data, n);
            (*deleter)(deleter_arg, data, n);
        }
        _dest += n;
        _len -= n;
    }

private:
    char* _dest;
    int _len;
};

#undef compress

Buf
Compression::compress(Buf buf, std::string type)
{
    if (type == "snappy") {
        static const int EXTRA_ALLOC = 16 * 1024;
        snappy::ByteArraySource source(buf.cdata(), buf.length());
        BufSink sink(buf.length() + EXTRA_ALLOC);
        size_t compressed_len = snappy::Compress(&source, &sink);
        Buf compressed = sink.get_buffer();
        if (compressed.length() != static_cast<int>(compressed_len)) {
            throw Exception("SNAPPY compressed length mismatch");
        }
        return compressed;
    } else if (type == "zlib") {
        static const int ZLIB_LEVEL = 1;
        int compressed_len = compressBound(buf.length());
        Buf compressed(compressed_len);
        unsigned long real_len = compressed_len;
        int ret = compress2(compressed.data(), &real_len, buf.data(), buf.length(), ZLIB_LEVEL);
        if (ret != Z_OK) {
            throw Exception(std::string("ZLIB ") + zError(ret));
        }
        compressed.slice(0, real_len);
        return compressed;
    } else if (type.empty()) {
        return buf;
    } else {
        throw Exception(std::string("Compression not supported ") + type);
    }
}

Buf
Compression::decompress(Buf buf, int decompressed_len, std::string type)
{
    if (type == "snappy") {
        snappy::ByteArraySource source(buf.cdata(), buf.length());
        Buf decompressed(decompressed_len);
        CheckedByteArraySink sink(decompressed.cdata(), decompressed_len);
        bool ret = snappy::Uncompress(&source, &sink);
        if (!ret) {
            throw Exception("SNAPPY decompress failed");
        }
        if (sink.get_remaining_bytes()) {
            throw Exception("SNAPPY decompress remaining bytes");
        }
        return decompressed;
    } else if (type == "zlib") {
        Buf decompressed(decompressed_len);
        unsigned long real_len = decompressed_len;
        int ret = uncompress(decompressed.data(), &real_len, buf.data(), buf.length());
        if (ret != Z_OK) {
            throw Exception(std::string("ZLIB ") + zError(ret));
        }
        decompressed.slice(0, real_len);
        return decompressed;
    } else if (type.empty()) {
        return buf;
    } else {
        throw Exception(std::string("Compression not supported ") + type);
    }
}

} // namespace noobaa
