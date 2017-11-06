/* Copyright (C) 2016 NooBaa */
#pragma once

#include <stdlib.h>
#include <vector>

#ifdef _WIN32
// TODO Backtrace on windows
#else
#include <cxxabi.h>
#include <dlfcn.h>
#include <execinfo.h>
#endif

namespace noobaa
{

class Backtrace
{
public:
    struct Entry {
        explicit Entry(
            void* addr_,
            std::string file_,
            int line_,
            std::string func_)
            : addr(addr_)
            , file(file_)
            , line(line_)
            , func(func_)
        {
        }
        void* addr;
        std::string file;
        int line;
        std::string func;
    };

    enum { MAX_DEPTH = 96 };

    explicit Backtrace(int depth = 32, int skip = 0)
    {
#ifdef _WIN32
// TODO Backtrace on windows
#else
        assert(depth <= MAX_DEPTH);
        void* trace[MAX_DEPTH];
        int stack_depth = backtrace(trace, depth);
        for (int i = skip + 1; i < stack_depth; i++) {
            Dl_info info;
            if (!dladdr(trace[i], &info)) {
                break;
            }
            int status;
            std::string file(info.dli_fname);
            std::string func(info.dli_sname);
            char* demangled = abi::__cxa_demangle(info.dli_sname, NULL, 0, &status);
            if (status == 0 && demangled) {
                func = demangled;
            }
            if (demangled) {
                free(demangled);
            }
            if (file.empty()) {
                break; // entries after main
            }
            _stack.push_back(Entry(trace[i], file, 0, func));
        }
#endif
    }

    friend std::ostream& operator<<(std::ostream& os, Backtrace& bt)
    {
        os << "Backtrace:" << std::endl;
        int len = bt._stack.size();
        for (int i = 0; i < len; i++) {
            const Entry& e = bt._stack[i];
            os << "\t" << e.addr << " " << e.file << ":" << e.line << " " << e.func << std::endl;
        }
        return os;
    }

    void print() { std::cout << *this; }

private:
    std::vector<Entry> _stack;
};

} // namespace noobaa
