#ifndef MEM_H_
#define MEM_H_

#include "common.h"

/**
 * Wrap a nodejs buffer
 */
class Buf
{
public:
    explicit Buf(node::Buffer* buf)
    {
        init(buf);
    }

    explicit Buf(int len)
    {
        init(node::Buffer::New(len));
    }

    explicit Buf(const char* data, int len)
    {
        init(node::Buffer::New(data, len));
    }

    explicit Buf(v8::Handle<v8::Value> h)
    {
        init(h);
    }

    Buf(const Buf& other)
    {
        init(other);
    }

    Buf(const Buf& other, int offset, int len)
    {
        init(other);
        slice(offset, len);
    }

    ~Buf()
    {
        if (_ref.IsNearDeath()) {
            _ref.Dispose();
        }
    }

    const Buf& operator=(const Buf& other)
    {
        this->~Buf();
        new (this)Buf(other);
        return other;
    }

    inline v8::Persistent<v8::Value> handle()
    {
        return _ref;
    }

    inline uint8_t* data()
    {
        return reinterpret_cast<uint8_t*>(_data);
    }

    inline int length()
    {
        return _len;
    }

    inline void slice(int offset, int len)
    {
        // skip to offset
        if (offset > _len) {
            offset = _len;
        }
        if (offset < 0) {
            offset = 0;
        }
        _data += offset;
        _len -= offset;
        // truncate to length
        if (_len > len) {
            _len = len;
        }
        if (_len < 0) {
            _len = 0;
        }
    }

    inline void reset()
    {
        _data = node::Buffer::Data(_ref);
        _len = node::Buffer::Length(_ref);
    }

    template <typename Iter>
    static Buf concat(Iter begin, Iter end, int len) {
        Buf ret(len);
        uint8_t* data = ret.data();
        while (len > 0) {
            assert(begin != end);
            int now = std::min<int>(len, begin->length());
            memcpy(data, begin->data(), now);
            data += now;
            len -= now;
            begin++;
        }
        return ret;
    }

private:

    void init(node::Buffer* buf)
    {
        NanAssignPersistent(_ref, static_cast<v8::Handle<v8::Value> >(NanNew(buf->handle_)));
        _data = node::Buffer::Data(buf);
        _len = node::Buffer::Length(buf);
    }

    void init(const Buf& other)
    {
        NanAssignPersistent(_ref, other._ref);
        _data = other._data;
        _len = other._len;
    }

    void init(v8::Handle<v8::Value> h)
    {
        NanAssignPersistent(_ref, h);
        _data = node::Buffer::Data(_ref);
        _len = node::Buffer::Length(_ref);
    }

    v8::Persistent<v8::Value> _ref;
    char* _data;
    int _len;
};

#endif // MEM_H_
