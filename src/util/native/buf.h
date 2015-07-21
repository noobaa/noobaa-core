#ifndef MEM_H_
#define MEM_H_

#include "common.h"

class Iovec
{
private:
    uint8_t* _data;
    int _len;

public:
    typedef std::shared_ptr<Iovec> SharedPtr;

    explicit Iovec(int len)
        : _data(new uint8_t[len])
        , _len(len)
    {
    }

    explicit Iovec(void* data, int len)
        : _data(reinterpret_cast<uint8_t*>(data))
        , _len(len)
    {
    }

    explicit Iovec(const void* data, int len)
        : _data(reinterpret_cast<uint8_t*>(const_cast<void*>(data)))
        , _len(len)
    {
    }

    Iovec(const Iovec& other)
        : _data(new uint8_t[other._len])
        , _len(other._len)
    {
        memcpy(_data, other._data, _len);
    }

    ~Iovec()
    {
        delete[] _data;
    }

    inline uint8_t* data()
    {
        return _data;
    }

    template <typename T>
    inline T* datap()
    {
        return reinterpret_cast<T*>(_data);
    }

    inline int length()
    {
        return _len;
    }
};

/**
 * Wrap a nodejs buffer
 */
class Buf
{
public:

    Buf()
        : _data(0)
        , _len(0)
    {
    }

    explicit Buf(int len)
        : _iovec(new Iovec(len))
        , _data(_iovec->data())
        , _len(_iovec->length())
    {
    }

    explicit Buf(void* data, int len, bool own)
        : _iovec(own ? new Iovec(data, len) : 0)
        , _data(reinterpret_cast<uint8_t*>(data))
        , _len(len)
    {
    }

    explicit Buf(const void* data, int len, bool own)
        : _iovec(own ? new Iovec(data, len) : 0)
        , _data(reinterpret_cast<uint8_t*>(const_cast<void*>(data)))
        , _len(len)
    {
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

    // copyful concat
    template <typename Iter>
    Buf(int len, Iter begin, Iter end)
        : _iovec(new Iovec(len))
        , _data(_iovec->data())
        , _len(_iovec->length())
    {
        uint8_t* data = _data;
        while (len > 0) {
            assert(begin != end);
            int now = std::min<int>(len, begin->length());
            memcpy(data, begin->data(), now);
            data += now;
            len -= now;
            begin++;
        }
    }

    ~Buf()
    {
    }

    const Buf& operator=(const Buf& other)
    {
        init(other);
        return other;
    }

    inline uint8_t* data()
    {
        return _data;
    }

    template <typename T>
    inline T* datap()
    {
        return reinterpret_cast<T*>(_data);
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
        _data = _iovec->data();
        _len = _iovec->length();
    }

    inline std::string hex()
    {
        std::string str;
        for (int i=0; i<_len; ++i) {
            str += BYTE_TO_HEX[_data[i]];
        }
        return str;
    }

private:

    void init(const Buf& other)
    {
        _iovec = other._iovec;
        _data = other._data;
        _len = other._len;
    }

    Iovec::SharedPtr _iovec;
    uint8_t* _data;
    int _len;

private:
    static const char* BYTE_TO_HEX[256];
};

#endif // MEM_H_
