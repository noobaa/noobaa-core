#ifndef WIN32
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int
change_path_permissions(const char* path, long uid)
{
    printf("setting permissions of %s for user %ld\n", path, uid);
    // change ownership
    int res = chown(path, uid, 0);
    if (res != 0) {
        printf("got error when changing ownership of %s. Error: %s\n", path, strerror(errno));
        exit(1);
    }
    // change mode to 755
    res = chmod(path, S_IRWXU | S_IRGRP | S_IXGRP | S_IROTH | S_IXOTH);
    if (res != 0) {
        printf("got error when changing mode of %s. Error: %s\n", path, strerror(errno));
        exit(1);
    }
    printf("changed permissions of %s succesfully\n", path);
    return 0;
}

int
main(int argc, char* argv[])
{
    if (argc != 3) {
        printf("expected to get server\\agent and uid\n");
        return 1;
    }

    long uid = atol(argv[2]);
    if (uid == 0) {
        printf("got 0 as uid - only root will get access. uid passed in argument was %s\n", argv[2]);
    }

    if (strcmp(argv[1], "server") == 0) {
        change_path_permissions("/data", uid);
        change_path_permissions("/log", uid);
    } else if (strcmp(argv[1], "agent") == 0) {
        change_path_permissions("/noobaa_storage", uid);
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
