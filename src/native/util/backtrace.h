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

/**
 * Collects and represents a stack backtrace for the current thread.
 */
 
/**
 * Represents a single stack frame entry.
 *
 * @param addr_ Address of the stack frame.
 * @param file_ Source file path or executable name associated with the frame (may be empty).
 * @param line_ Source line number if available, otherwise 0.
 * @param func_ Function name (demangled when possible) or an address-based hex string.
 */
 
/**
 * Capture the current call stack up to the specified depth, skipping the initial frames.
 *
 * This constructor resolves symbol names (attempting C++ demangling) and file names for
 * each captured frame and stores them as Entry objects. Processing stops when symbol or
 * file information is not available for subsequent frames.
 *
 * @param depth Maximum number of stack frames to capture (must be <= MAX_DEPTH).
 * @param skip Number of initial frames to skip (typically used to omit the Backtrace constructor and its callers).
 */
 
/**
 * Format and write the backtrace to the provided output stream.
 *
 * @param os Output stream to receive the formatted backtrace.
 * @param bt Backtrace instance whose entries will be written.
 * @returns Reference to the same output stream `os`.
 */
 
/**
 * Print the backtrace to standard output.
 */
namespace noobaa
{

class Backtrace
{
public:
    struct Entry
    {
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

    enum
    {
        MAX_DEPTH = 96
    };

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
            std::string func;
            if (info.dli_sname) {
                int status = -1;
                char* demangled = abi::__cxa_demangle(info.dli_sname, NULL, 0, &status);
                if (status == 0 && demangled) {
                    func = demangled;
                } else {
                    func = info.dli_sname;
                }
                if (demangled) {
                    free(demangled);
                }
            } else {
                std::stringstream s;
                s << "0x" << std::hex << uintptr_t(info.dli_saddr);
                func = s.str();
            }
            std::string file;
            if (info.dli_fname) {
                file = info.dli_fname;
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