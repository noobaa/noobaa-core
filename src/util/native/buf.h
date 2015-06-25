#ifndef MEM_H_
#define MEM_H_

/**
 * Wrap a nodejs buffer
 */
class Buf
{
public:
    explicit Buf(node::Buffer* buf)
        : _ref(buf->handle_)
        , _data(node::Buffer::Data(buf))
        , _len(node::Buffer::Length(buf))
    {
    }

    explicit Buf(int len)
        : Buf(node::Buffer::New(len))
    {
    }

    explicit Buf(const char* data, int len)
        : Buf(node::Buffer::New(data, len))
    {
    }

    explicit Buf(v8::Handle<v8::Value> h)
        : _ref(h)
        , _data(node::Buffer::Data(h))
        , _len(node::Buffer::Length(h))
    {
    }

    Buf(const Buf& other)
        : _ref(other._ref)
        , _data(other._data)
        , _len(other._len)
    {
    }

    ~Buf()
    {
        NanDisposePersistent(_ref);
    }

    inline char* data()
    {
        return _data;
    }

    inline uint8_t* udata()
    {
        return reinterpret_cast<uint8_t*>(data());
    }

    inline int length()
    {
        return _len;
    }

private:
    v8::Persistent<v8::Value> _ref;
    char* _data;
    int _len;
};


#endif // MEM_H_
