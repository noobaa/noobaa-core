/**
 * compile with: g++ --std=c++11
 */

#include <iostream>
#include <chrono>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <netinet/in.h>
#include <arpa/inet.h>

using std::cout;
using std::cerr;
using std::endl;
using std::string;

#define FATAL(desc) \
    do { \
        cerr << "FATAL ERROR " \
            << strerror(errno) \
            << " " << desc \
            << endl; \
        exit(171); \
    } while(0)

#define SYSCALL(x) \
    do { \
        int __rc__ = x; \
        if (__rc__ < 0) { \
            FATAL(#x << " returned " << __rc__); \
        } \
    } while(0)

class Socket
{
private:
    int _fd;

public:
    Socket() : _fd(0)
    {
    }

    ~Socket()
    {
        close();
    }

    void close()
    {
        if (_fd) {
            SYSCALL(::close(_fd));
            _fd = 0;
        }
    }

    void init_tcp()
    {
        close();
        SYSCALL(_fd = socket(PF_INET, SOCK_STREAM, 6));
    }

    void init_fd(int fd)
    {
        close();
        _fd = fd;
    }

    void connect(int port, const char* ip = "127.0.0.1")
    {
        struct sockaddr_in sin;
        sin.sin_family = AF_INET;
        sin.sin_port = htons(port);
        SYSCALL(inet_aton(ip, &sin.sin_addr));
        SYSCALL(::connect(_fd, reinterpret_cast<struct sockaddr*>(&sin), sizeof(sin)));
    }

    void bind(int port, const char* ip = "127.0.0.1")
    {
        struct sockaddr_in sin;
        sin.sin_family = AF_INET;
        sin.sin_port = htons(port);
        SYSCALL(inet_aton(ip, &sin.sin_addr));
        SYSCALL(::bind(_fd, reinterpret_cast<struct sockaddr*>(&sin), sizeof(sin)));
    }

    void listen()
    {
        SYSCALL(::listen(_fd, 5));
    }

    void accept(Socket& sock)
    {
        struct sockaddr_in sin;
        unsigned int sin_len = 0;
        int fd = 0;
        SYSCALL(fd = ::accept(_fd, reinterpret_cast<struct sockaddr*>(&sin), &sin_len));
        sock.init_fd(fd);
    }

    int write_some(const char* buf, int len)
    {
        int n = -1;
        SYSCALL(n = ::write(_fd, buf, len));
        return n;
    }

    int read_some(char* buf, int len)
    {
        int n = 0;
        SYSCALL(n = ::read(_fd, buf, len));
        return n;
    }

    void write_all(const char* buf, int len)
    {
        int pos = 0;
        while (len > 0) {
            int n = write_some(buf + pos, len);
            if (!n) {
                FATAL("SOCKET EOF");
            }
            pos += n;
            len -= n;
        }
    }

    void read_all(char* buf, int len)
    {
        int pos = 0;
        while (len > 0) {
            int n = read_some(buf + pos, len);
            if (!n) {
                FATAL("SOCKET EOF");
            }
            pos += n;
            len -= n;
        }
    }

};

class Speedometer
{
private:
    typedef std::chrono::time_point<std::chrono::steady_clock> time_type;
    uint64_t num_bytes;
    uint64_t last_bytes;
    time_type start_time;
    time_type last_time;
public:
    Speedometer()
        : num_bytes(0)
        , last_bytes(0)
        , start_time(std::chrono::steady_clock::now())
        , last_time(start_time)
    {
    }

    void update(int bytes)
    {
        num_bytes += bytes;
        const time_type curr_time = std::chrono::steady_clock::now();
        const double last_secs =
            std::chrono::duration<double>(curr_time - last_time).count();
        if (last_secs >= 1) {
            const double start_secs =
                std::chrono::duration<double>(curr_time - start_time).count();
            const double speed = (num_bytes - last_bytes) / 1024 / 1024 / last_secs;
            const double avg_speed = num_bytes / 1024 / 1024 / start_secs;
            cout << speed << " MB/sec  (average ~" << avg_speed << ")" << endl;
            last_time = curr_time;
            last_bytes = num_bytes;
        }
    }

};

void usage()
{
    cout << "Usage:" << endl;
    cout << "    tcp_speed client" << endl;
    cout << "or:" << endl;
    cout << "    tcp_speed server" << endl;
    exit(1);
}

int main(int ac, char** av)
{
    const string client_or_server = ac > 1 ? string(av[1]) : "";
    const int buf_size = ac > 2 ? atoi(av[2]) : 1024 * 1024;

    const int hdr_len = 4;
    char* hdr = new char[hdr_len];
    char* buf = new char[buf_size];
    Speedometer speedometer;

    if (client_or_server == "client") {
        cout << "Runing client ..." << endl;
        Socket client;
        client.init_tcp();
        client.connect(13579);
        auto start_time = std::chrono::steady_clock::now();
        auto last_time = start_time;
        while (true) {
            int msg_len = buf_size;
            *reinterpret_cast<int*>(hdr) = htonl(msg_len);
            client.write_all(hdr, hdr_len);
            client.write_all(buf, msg_len);
            speedometer.update(msg_len);
        }
        client.close();
    } else if (client_or_server == "server") {
        cout << "Runing server ..." << endl;
        Socket server;
        Socket conn;
        server.init_tcp();
        server.bind(13579);
        server.listen();
        server.accept(conn);
        while (true) {
            conn.read_all(hdr, hdr_len);
            int msg_len = ntohl(*reinterpret_cast<int*>(hdr));
            conn.read_all(buf, msg_len);
            speedometer.update(msg_len);
        }
        conn.close();
        server.close();
    } else {
        usage();
    }

    return 0;
}
