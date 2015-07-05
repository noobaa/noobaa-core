#ifndef BACKTRACE_H_
#define BACKTRACE_H_

#include <execinfo.h>
#include <cxxabi.h>
#include <dlfcn.h>
#include <stdlib.h>

class Backtrace
{
public:

    struct Entry
    {
        explicit Entry(void* addr_, std::string file_, int line_, std::string func_)
            : addr(addr_), file(file_), line(line_), func(func_)
        {
        }
        void* addr;
        std::string file;
        int line;
        std::string func;
    };

    explicit Backtrace(int depth = 32, int skip = 0)
    {
        void* trace[depth];
        int stack_depth = backtrace(trace, depth);
        for (int i = skip+1; i < stack_depth; i++) {
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
    }

    void print()
    {
        int len = _stack.size();
        for (int i=0; i<len; i++) {
            const Entry& e = _stack[i];
            std::cout << "BT \t" << e.addr << " " << e.file << ":" << e.line << " " << e.func << std::endl;
        }
    }

private:
    std::vector<Entry> _stack;
};

#endif // BACKTRACE_H_
