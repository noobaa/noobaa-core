#ifndef WIN32
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

int
main(int argc, char* argv[])
{
    if (argc != 2) {
        printf("expected to get uid only\n");
        return 1;
    }

    long uid = atol(argv[1]);
    if (uid == 0) {
        printf("got 0 as uid - only root will get access. uid passed in argument was %s\n", argv[1]);
    }

    const char* data_vol = "/data";
    const char* log_vol = "/log";

    // change ownership
    int res = chown(data_vol, uid, 0);
    if (res == -1) {
        printf("got error when changing ownership of /data\n");
        return 1;
    }
    res = chown(log_vol, uid, 0);
    if (res == -1) {
        printf("got error when changing ownership of /log\n");
        return 1;
    }

    // change mode to 755
    res = chmod(data_vol, S_IRWXU | S_IRGRP | S_IXGRP | S_IROTH | S_IXOTH);
    if (res == -1) {
        printf("got error when changing mode of /data\n");
        return 1;
}
    res = chmod(log_vol, S_IRWXU | S_IRGRP | S_IXGRP | S_IROTH | S_IXOTH);
    if (res == -1) {
        printf("got error when changing mode of /log\n");
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
