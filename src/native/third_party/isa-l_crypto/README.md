Intel(R) Intelligent Storage Acceleration Library Crypto Version
================================================================

ISA-L_crypto is a collection of optimized low-level functions targeting storage
applications.  ISA-L_crypto includes:

* Multi-buffer hashes - run multiple hash jobs together on one core for much
  better throughput than single-buffer versions.
  - SHA1, SHA256, SHA512, MD5

* Multi-hash - Get the performance of multi-buffer hashing with a single-buffer
  interface.

* Multi-hash + murmur - run both together.

* AES - block ciphers
  - XTS, GCM, CBC

* Rolling hash - Hash input in a window which moves through the input

See [ISA-L_crypto for updates.](https://github.com/01org/isa-l_crypto)
For non-crypto ISA-L see [isa-l on github.](https://github.com/01org/isa-l)

Building ISA-L
--------------

### Prerequisites

* yasm version 1.2.0 or later or nasm v2.11.01 or later.
* gcc, clang, icc or VC compiler.
* GNU 'make' or 'nmake' (Windows).
* Building with autotools requires autoconf/automake packages.

### Autotools
To build and install the library with autotools it is usually sufficient to run:

    ./autogen.sh
    ./configure
    make
    sudo make install

### Makefile
To use a standard makefile run:

    make -f Makefile.unx

### Windows
On Windows use nmake to build dll and static lib:

    nmake -f Makefile.nmake

### Other make targets
Other targets include:
* `make check` : create and run tests
* `make tests` : create additional unit tests
* `make perfs` : create included performance tests
* `make ex`    : build examples
* `make doc`   : build API manual
