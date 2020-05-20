#ifndef WIN32
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <iostream>
#include <stdlib.h>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
using std::cerr;
using std::cout;
using std::endl;

int
change_path_permissions(const char* path, long uid)
{
    cout << "setting permissions of " << path << " for user " << uid << endl;
    // change ownership
    int fd = open(path, O_RDONLY);
    if (fd == -1) {
        cout << "Error:got error when openning " << path << " Error: " << strerror(errno) << endl;
        exit(1);
    }
    int res = fchown(fd, uid, 0);
    if (res != 0) {
        cout << "Error:got error when changing ownership of " << path << " Error: " << strerror(errno) << endl;
        exit(1);
    }
    // change mode to 770
    res = fchmod(fd, S_IRWXU | S_IRWXG);
    if (res != 0) {
        cout << "Error: got error when changing mode of " << path << " Error: " << strerror(errno) << endl;
        exit(1);
    }
    cout << "changed permissions of " << path << " succesfully" << endl;
    close(fd);
    return 0;
}

void
change_path_permissions_recursive(std::string path, long uid)
{
    change_path_permissions(path.c_str(), uid);
    DIR* dir = opendir(path.c_str());
    if (!dir) {
        if (errno != ENOTDIR) {
            cerr << "Error: opendir(" << path << ") failed " << strerror(errno) << endl;
            exit(1);
        }
        return;
    }
    struct dirent* entry;
    while ((entry = readdir(dir)) != NULL) {
        std::string entry_name = entry->d_name;
        std::string entry_path = path + "/" + entry_name;
        if (entry_name != "." && entry_name != "..") {
            change_path_permissions_recursive(entry_path, uid);
        }
    }
    closedir(dir);
}

int
main(int argc, char* argv[])
{
    if (argc != 2) {
        cout << "Error: expected to get server/agent and uid" << endl;
        return 1;
    }

    std::string deployment_type(argv[1]);
    long uid = getuid();
    if (uid == 0) {
        cout << "Warning: got 0 as uid - only root will get access" << endl;
    }

    if (deployment_type == "server") {
        change_path_permissions("/log", uid);
    } else if (deployment_type == "mongo") {
        change_path_permissions_recursive("/data", uid);
    } else if (deployment_type == "agent") {
        change_path_permissions("/noobaa_storage", uid);
    } else {
        cout << "Error:  expected to get server/agent as first parameter" << endl;
        return 1;
    }
    return 0;
}

#else
int
main(int argc, char* argv[])
{
    return 0;
}
#endif
