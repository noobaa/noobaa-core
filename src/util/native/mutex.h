#ifndef MUTEX_H_
#define MUTEX_H_

#include "common.h"

/**
 *
 * MUTEX
 *
 */
class Mutex
{
public:
    explicit Mutex()
    {
        uv_mutex_init(&_mutex);
    }

    virtual ~Mutex()
    {
        uv_mutex_destroy(&_mutex);
    }

    void lock()
    {
        uv_mutex_lock(&_mutex);
    }

    void unlock()
    {
        uv_mutex_unlock(&_mutex);
    }

    int trylock()
    {
        return uv_mutex_trylock(&_mutex);
    }

    class Lock
    {
public:
        explicit Lock(Mutex& m) : _m(m), _locked(false)
        {
            _m.lock();
            _locked = true;
        }
        void unlock()
        {
            if (_locked) {
                _locked = false;
                _m.unlock();
            }
        }
        virtual ~Lock()
        {
            unlock();
        }
protected:
        Mutex& _m;
        bool _locked;
    };

protected:
    uv_mutex_t _mutex;
};


/**
 *
 * MUTEX & COND
 *
 */
class MutexCond : public Mutex
{
public:
    explicit MutexCond() : Mutex()
    {
        uv_cond_init(&_cond);
    }

    virtual ~MutexCond()
    {
        uv_cond_destroy(&_cond);
    }

    void wait()
    {
        uv_cond_wait(&_cond, &_mutex);
    }

    void signal()
    {
        uv_cond_signal(&_cond);
    }

protected:
    uv_cond_t _cond;
};

#endif // MUTEX_H_
