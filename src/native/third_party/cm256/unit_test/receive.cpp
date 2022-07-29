/*
    Copyright (c) 2016 Edouard M. Griffiths.  All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.
    * Neither the name of CM256 nor the names of its contributors may be
      used to endorse or promote products derived from this software without
      specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
    CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
    SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
    INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
    CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
    ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
    POSSIBILITY OF SUCH DAMAGE.
*/

#include <iostream>
#include <string>
#include <atomic>
#include <csignal>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <unistd.h>
#include <getopt.h>

#include "mainutils.h"
#include "example0.h"
#include "example1.h"
#include "../cm256.h"

/** Flag is set on SIGINT / SIGTERM. */
static std::atomic_bool stop_flag(false);

/** Handle Ctrl-C and SIGTERM. */
static void handle_sigterm(int sig)
{
    stop_flag.store(true);

    std::string msg = "\nGot signal ";
    msg += strsignal(sig);
    msg += ", stopping ...\n";

    const char *s = msg.c_str();
    ssize_t r = write(STDERR_FILENO, s, strlen(s));

    if (r != (ssize_t) strlen(s)) {
        msg += " write incomplete";
    }
}

static void usage()
{
    fprintf(stderr,
    "Usage: cm256_rx [options]\n"
    "\n"
    "  -c case        Test case index\n"
    "     - 0: file test:\n"
    "  -f file        test file\n"
    "  -r ref_file    reference file\n"
    "     - 1: UDP test:\n"
    "  -I address     IP address. Samples are sent to this address (default: 127.0.0.1)\n"
    "  -p port        Data port. Samples are sent on this UDP port (default 9090)\n"
    "\n");
}

int main(int argc, char *argv[])
{
    int testCaseIndex = 0;
    std::string dataaddress("127.0.0.1");
    int dataport = 9090;
    std::string filename("cm256.test");
    std::string refFilename("cm256.ref.test");

    struct sigaction action;
    memset(&action, 0, sizeof(struct sigaction));
    action.sa_handler = handle_sigterm;
    sigaction(SIGTERM, &action, NULL);

    const struct option longopts[] = {
        { "case",       1, NULL, 'c' },
        { "daddress",   2, NULL, 'I' },
        { "dport",      1, NULL, 'P' },
        { "file",       2, NULL, 'f' },
        { "reffile",    2, NULL, 'r' },
        { NULL,         0, NULL, 0 } };

    int c, longindex, value;
    while ((c = getopt_long(argc, argv,
            "c:I:P:f:r:",
            longopts, &longindex)) >= 0)
    {
        switch (c)
        {
        case 'c':
            if (!parse_int(optarg, value) || (value < 0) || (value > 1)) {
                badarg("-b");
            } else {
                testCaseIndex = value;
            }
            break;
        case 'I':
            dataaddress.assign(optarg);
            break;
        case 'P':
            if (!parse_int(optarg, value) || (value < 0)) {
                badarg("-P");
            } else {
                dataport = value;
            }
            break;
        case 'f':
            filename.assign(optarg);
            break;
        case 'r':
            refFilename.assign(optarg);
            break;
        default:
            usage();
            fprintf(stderr, "ERROR: Invalid command line options\n");
            exit(1);
        }
    }

    if (optind < argc)
    {
        usage();
        fprintf(stderr, "ERROR: Unexpected command line options\n");
        exit(1);
    }

    if (testCaseIndex == 0)
    {
        std::cerr << "example0:" << std::endl;

        if (!example0_rx(filename, refFilename))
        {
            std::cerr << "example0 failed" << std::endl << std::endl;
            return 1;
        }

        std::cerr << "example0 successful" << std::endl;
    }
    else if (testCaseIndex == 1)
    {
        std::cerr << "example1:" << std::endl;

        if (!example1_rx(dataaddress, (unsigned short) dataport, stop_flag))
        {
            std::cerr << "example1 failed" << std::endl << std::endl;
            return 1;
        }

        std::cerr << "example1 successful" << std::endl;
    }

    return 0;
}



