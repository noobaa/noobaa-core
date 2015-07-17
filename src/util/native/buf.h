#ifndef MEM_H_
#define MEM_H_

#include "common.h"

class Iovec
{
private:
    char* _data;
    int _len;

public:
    typedef std::shared_ptr<Iovec> SharedPtr;

    explicit Iovec(int len)
        : _data(new char[len])
        , _len(len)
    {
    }

    explicit Iovec(char* data, int len)
        : _data(data)
        , _len(len)
    {
    }

    explicit Iovec(const char* data, int len)
        : _data(const_cast<char*>(data))
        , _len(len)
    {
    }

    Iovec(const Iovec& other)
        : _data(new char[other._len])
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
        return reinterpret_cast<uint8_t*>(_data);
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

    explicit Buf(char* data, int len)
        : _iovec(new Iovec(data, len))
        , _data(_iovec->data())
        , _len(_iovec->length())
    {
    }

    explicit Buf(const char* data, int len)
        : _iovec(new Iovec(data, len))
        , _data(_iovec->data())
        , _len(_iovec->length())
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

    ~Buf()
    {
    }

    const Buf& operator=(const Buf& other)
    {
        this->~Buf();
        new (this)Buf(other);
        return other;
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
        _data = _iovec->data();
        _len = _iovec->length();
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
