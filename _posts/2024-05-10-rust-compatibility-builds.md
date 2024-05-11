# Compatibility Builds With Rust

- [Compatibility Builds With Rust](#compatibility-builds-with-rust)
  - [Linking glibc](#linking-glibc)
  - [glibc Versions](#glibc-versions)
  - [Linker Options](#linker-options)
  - [Building Against A Super Old glibc](#building-against-a-super-old-glibc)
  - [Building LLVM on Fedora 20](#building-llvm-on-fedora-20)
  - [Downloading Dependencies](#downloading-dependencies)
  - [Making a Dockerfile](#making-a-dockerfile)
  - [Building our Project](#building-our-project)
  - [Using In CI](#using-in-ci)

The [product](https://github.com/intel/tsffs) I work on is written in Rust and 
distributed as a dynamic library, so a `.so` on Linux and a `.dll` on Windows.
The library is basically a plugin, so it's loaded with
`dlopen(file_path, RTLD_NOW)`.

So, I have a problem. More specifically, I had a problem which caused a problem, which
...caused a problem. Let's get into it.

## Linking glibc

In a typical Rust codebase, `glibc` is going to get linked. It's possible not to by
either statically linking with either `glibc` or `musl-libc` using
[`+crt-static`](https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes),
and typically this is what's done when Rust binaries are distributed.  Unfortunately,
there are a couple reasons we can't do this here, most important of which is that we are
not actually distributing an executable, just a library. The approach outlined here is
also *useful* for binaries though, because often you can't just statically link glibc,
especially if you're using any non-bulletproof-to-weird-linkage C libraries via FFI.

First, our dynamic library gets `dlopen`-ed by a binary which itself is linked with
`glibc`. This means if we statically link `glibc` we're going to end up having *two*
different `glibc`s, which is a serious issue when we do things like...allocate memory.

Second, it makes the binary size way too big. We're passing around dynamic libraries
that aren't LLVM, so we really would prefer they aren't 100MB+ in size. This isn't iOS
app development.

If we make a crate with:

```sh
cargo new --lib rust-compat-test
```

And then add the libc crate dependency and change the crate type to `cdylib` with:

```sh
cat >> Cargo.toml <<EOF
libc = "*"

[lib]
crate-type = ["cdylib"]
EOF
```

We'll just add one externally visible function to the library:

```sh
cat > src/lib.rs <<EOF
use libc::malloc;

#[no_mangle]
pub extern "C" fn test() {
    unsafe {
        let ptr = malloc(1);
        println!("{:?}", ptr);
    }
}
EOF
```

And build:

```sh
cargo build -r
```

We'll end up with a dynamic library which links `glibc`:

```sh
$ ldd target/release/librust_compat_test.so                                        
	linux-vdso.so.1 (0x00007ffdd1de1000)
	libgcc_s.so.1 => /lib64/libgcc_s.so.1 (0x00007f4d9590c000)
	libc.so.6 => /lib64/libc.so.6 (0x00007f4d9572a000)
	/lib64/ld-linux-x86-64.so.2 (0x00007f4d95955000)
```

We can double check that there is an undefined symbol as we can expect too:

```sh
nm -u target/release/librust_compat_test.so
```

## glibc Versions

If you've ever tried to load a binary or library linked with a new version of glibc on
an old system, you've probably seen an error like:

```txt
/lib64/libc.so.6: version `GLIBC_2.28' not found (required by ...)
```

Let's try this with our library by using `docker` to run a program on SLES 12 SP 5 (a
very, very out of date image) that `dlopen`s our library.

```sh
cat >> Dockerfile <<EOF
FROM fedora:20

RUN dnf -y update && \
    dnf -y install gcc

COPY target/release/librust_compat_test.so librust_compat_test.so

COPY <<EOF test.c
#include <dlfcn.h>
#include <stdio.h>

int main() {

    void *f = dlopen("/librust_compat_test.so", RTLD_NOW);

    if (f == NULL) {
        char *err = dlerror();
        printf("error: %s\\n", err);
        return 1;
    }

    void (*test)(void) = (void (*)(void)dlsym(f, "test"));

    test();

    return 0;
}
EOF

RUN gcc -o test test.c
```

Build the docker image:

```sh
docker build -t rust-compat-test .
```

And then run it:

```sh
$ docker run t rust-compat-test ./test
error: /lib64/libc.so.6: version `GLIBC_2.28' not found (required by /librust_compat_test.so)
```

This is the error we're after (and the one we want to solve).

## Linker Options

There are a couple things we can do to solve this. First, we can use the [`gc-sections`
directive](https://gcc.gnu.org/onlinedocs/gnat_ugn/Compilation-options.html) to have the
linker perform dead code elimination. Instead of building with:

```sh
cargo build -r
```

We can build with:

```sh
cargo rustc -r -- -C link-args="-Wl,--gc-sections"
```

In real programs/libraries, this can help significantly by reducing the number of
symbols and libraries the program/library tries to link with. In particular, this
matters when `RTLD_NOW` is used as a flag for `dlopen`. Using `gc-sections` helps
by only having the dynamic linker look up symbols which are actually used. Because
Rust code is statically linked, we can end up with a very large number of unused
symbols (particularly in debug binaries) which are completely unused.

This doesn't, however, solve the problem of symbol versioning between linked and
present `glibc` versions, so we need to do a bit more.

## Building Against A Super Old glibc

Obviously, the easiest way to link against a super old libc is to build against a super
old libc. There are a couple ways to do this -- you can build an old version on your
machine and link with it. This is harder than it sounds, you need to set a lot of
compiler and linker options to make sure they don't accidentally pick up your (hopefully
current) version installed.

And the easiest way to build against a super old libc is to use `docker` again.

```sh
$ docker run -t fedora:20 /lib64/libc.so.6
GNU C Library (GNU libc) stable release version 2.18, by Roland McGrath et al.
```

Fedora 20 has `glibc` 2.18, and Rust supports only
[`>=2.17`](https://blog.rust-lang.org/2022/08/01/Increasing-glibc-kernel-requirements.html).
Fedora 20 is the oldest version officially [available](https://hub.docker.com/_/fedora/)
from Docker Hub, so we'll call that good enough and use it.

I've already solved a lot of problems introduced by this decision, so instead of walking
through the process and pretending to run into issues, I'll outline them:

* The `ld.bfd` version used in Fedora 20 mishandles the output of `DT_NEEDED` entries
  when linking against separate libraries by inserting only absolute paths.
* Patching those absolute paths to non-absolute paths/filenames using `patchelf` results
  in ELF file corruption. I'm unsure whether this is the fault of `patchelf` (likely)
  or `ld.bfd` (possible), but it results in an ELF which looks totally valid but will
  break when it's loaded. This is..not good!

There's an "easy" solution to this where we just avoid using `gcc` or `ld.bfd` at all.
Unfortunately, the packaged version of `clang`, `lld`, and the `llvm` toolchain for
Fedora 20 is `3.4`, which is too old to use with some arguments emitted by Rust.

So instead, we'll just build LLVM from scratch. Let's get started!

## Building LLVM on Fedora 20

Like mentioned earlier, LLVM 3.4 is too old to use for this, but LLVM versions above
5 have build issues using the packaged GCC version on Fedora 20. This means we can use
LLVM 5 (specifically, LLVM 5.0.2). There are a only a couple dependencies we need to
build LLVM 5.0.2:

* GCC
* CMake
* Make

All three of these are packaged for Fedora 20, but the packaged CMake is incompatible
with some directives used in the LLVM 5.0.2 configuration. The packaged Make is
incompatible with some syntax emitted by the CMake configuration, but the *newest* Make
(actually, any version after 4.4.1) has a bug which causes the Makefile to continuously
evaluate itself, causing an infinite loop.

Clearly, this is a very stable build environment!

Anyway, Make and CMake happen to be very easy to also build from source, so we can just
do that, then use them to build LLVM, and we'll be all set! Once we've done that, we can
just un-tar the Rust install tarball and run its (offline, which rules!) installer.

Oh, and there are a couple more wrinkles we should keep in mind:

* cURL on Fedora 20 is so old it doesn't support most HTTPS sites, has improper handling
  of proxies, and even if that works, good luck with the certificates. We'll just be
  downloading the dependencies on the host and copying them into the container.
* The yum repositories for Fedora 20 are still up, but they're starting to have
  certificate issues as well (started in late 2023). For this reason, we'll be
  downloading the RPMs and copying them in. We'll use the Fedora 20 container to do
  this, but having them locally makes them easier to retrieve if (or rather when) the
  official package repositories stop working.

## Downloading Dependencies

First, let's make a quick script to download the dependencies we need. We'll also verify
the hashes (or signatures, whichever is available) on all the downloaded files. This
helps make the process more resilient in CI environments. Basically, this script is
going to download a *bunch* of stuff and check the hashes.

We download each of the tarballs, signatures, and GPG keys for verification, then use
the GPG keys and hashes to verify all the signatures and downloaded files. Next, we use
a docker command to download the tarballs for all the system dependencies we need to
build the specific versions of each of our LLVM dependencies. And that's it! We'll call
this script `./build.sh`

```sh
#!/bin/bash

download_if_missing() {
    if [ ! -f "${1}" ]; then
        curl -L -o "${1}" "${2}"
    fi
}


SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)

set -e

pushd "${SCRIPT_DIR}" > /dev/null || exit 1

mkdir -p rsrc

rm -f rsrc/keyring.gpg

download_if_missing "rsrc/tstellar-gpg-key.asc" \
    "https://releases.llvm.org/5.0.2/tstellar-gpg-key.asc"
download_if_missing "rsrc/lld-5.0.2.src.tar.xz" \
    "https://releases.llvm.org/5.0.2/lld-5.0.2.src.tar.xz"
download_if_missing "rsrc/lld-5.0.2.src.tar.xz.sig" \
    "https://releases.llvm.org/5.0.2/lld-5.0.2.src.tar.xz.sig"
download_if_missing "rsrc/cfe-5.0.2.src.tar.xz" \
    "https://releases.llvm.org/5.0.2/cfe-5.0.2.src.tar.xz"
download_if_missing "rsrc/cfe-5.0.2.src.tar.xz.sig" \
    "https://releases.llvm.org/5.0.2/cfe-5.0.2.src.tar.xz.sig"
download_if_missing "rsrc/llvm-5.0.2.src.tar.xz" \
    "https://releases.llvm.org/5.0.2/llvm-5.0.2.src.tar.xz"
download_if_missing "rsrc/llvm-5.0.2.src.tar.xz.sig" \
    "https://releases.llvm.org/5.0.2/llvm-5.0.2.src.tar.xz.sig"
download_if_missing "rsrc/gnu-keyring.gpg" \
    "https://ftp.gnu.org/gnu/gnu-keyring.gpg"
download_if_missing "rsrc/make-4.4.1.tar.gz" \
    "https://ftp.gnu.org/gnu/make/make-4.4.1.tar.gz"
download_if_missing "rsrc/make-4.4.1.tar.gz.sig" \
    "https://ftp.gnu.org/gnu/make/make-4.4.1.tar.gz.sig"
download_if_missing "rsrc/cmake-3.29.3-linux-x86_64.tar.gz" \
    "https://github.com/Kitware/CMake/releases/download/v3.29.3/cmake-3.29.3-linux-x86_64.tar.gz"
download_if_missing "rsrc/cmake-3.29.3-SHA-256.txt" \
    "https://github.com/Kitware/CMake/releases/download/v3.29.3/cmake-3.29.3-SHA-256.txt"
download_if_missing "rsrc/cmake-3.29.3-SHA-256.txt.asc" \
    "https://github.com/Kitware/CMake/releases/download/v3.29.3/cmake-3.29.3-SHA-256.txt.asc"
download_if_missing "rsrc/cmake-pgp-key.asc" \
    "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0xcba23971357c2e6590d9efd3ec8fef3a7bfb4eda"
download_if_missing "rsrc/rust-key.gpg.ascii" \
    "https://static.rust-lang.org/rust-key.gpg.ascii"
download_if_missing "rsrc/rust-nightly-x86_64-unknown-linux-gnu.tar.xz" \
    "https://static.rust-lang.org/dist/rust-nightly-x86_64-unknown-linux-gnu.tar.xz"
download_if_missing "rsrc/rust-nightly-x86_64-unknown-linux-gnu.tar.xz.asc" \
    "https://static.rust-lang.org/dist/rust-nightly-x86_64-unknown-linux-gnu.tar.xz.asc"

gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --import rsrc/tstellar-gpg-key.asc
gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --import rsrc/gnu-keyring.gpg
gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --import rsrc/cmake-pgp-key.asc
gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --import rsrc/rust-key.gpg.ascii

gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --verify rsrc/lld-5.0.2.src.tar.xz.sig
gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --verify rsrc/cfe-5.0.2.src.tar.xz.sig
gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --verify rsrc/llvm-5.0.2.src.tar.xz.sig
gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --verify rsrc/make-4.4.1.tar.gz.sig
gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --verify rsrc/cmake-3.29.3-SHA-256.txt.asc
gpg --no-default-keyring --keyring rsrc/keyring.gpg \
    --verify rsrc/rust-nightly-x86_64-unknown-linux-gnu.tar.xz.asc

sha256sum rsrc/cmake-3.29.3-linux-x86_64.tar.gz | awk '{print $1}' | grep -q \
    "$(grep rsrc/cmake-3.29.3.tar.gz < rsrc/cmake-3.29.3-SHA-256.txt)"

if [ ! -d "rsrc/rpms" ]; then
    docker run -v "$(pwd)/rsrc/rpms:/rpms" fedora:20 bash -c \
        "yum -y update && yum install --downloadonly --downloaddir=/rpms coreutils gcc gcc-c++ make which && chmod -R 755 /rpms/ && chown $(id -u):$(id -g) -R /rpms"
fi
```

## Making a Dockerfile

To actually build LLVM and install Rust, we'll make a `Dockerfile`.

```dockerfile
FROM fedora:20 AS rust-installer

COPY rsrc /rsrc/

# Install RPMs
RUN yum -y install -y /rsrc/rpms/*.rpm && yum clean all

# Install Rust
RUN tar -C /rsrc -xf /rsrc/rust-nightly-x86_64-unknown-linux-gnu.tar.xz && \
    /rsrc/rust-nightly-x86_64-unknown-linux-gnu/install.sh && \
    rm -rf /rsrc/rust-nightly-x86_64-unknown-linux-gnu/


# Build & Install Make
RUN mkdir -p /rsrc/make && \
    tar -C /rsrc/make --strip-components=1 -xf /rsrc/make-4.4.1.tar.gz && \
    pushd /rsrc/make && \
    ./configure && \
    make && \
    make install && \
    make clean && \
    popd && \
    rm -rf /rsrc/make

# Install CMake
RUN tar -C /usr/local/ --strip-components=1 -xf /rsrc/cmake-3.29.3-linux-x86_64.tar.gz

# Build & Install LLVM, CLANG, LLD
RUN mkdir -p /rsrc/llvm/ && \
    mkdir -p /rsrc/llvm/tools/clang && \
    mkdir -p /rsrc/llvm/tools/lld && \
    tar -C /rsrc/llvm --strip-components=1 -xf /rsrc/llvm-5.0.2.src.tar.xz && \
    tar -C /rsrc/llvm/tools/clang --strip-components=1 -xf /rsrc/cfe-5.0.2.src.tar.xz && \
    tar -C /rsrc/llvm/tools/lld --strip-components=1 -xf /rsrc/lld-5.0.2.src.tar.xz && \
    mkdir -p /rsrc/llvm/build && \
    cmake -S /rsrc/llvm -B /rsrc/llvm/build -G "Unix Makefiles" \
        -DCMAKE_BUILD_TYPE="MinSizeRel" -DLLVM_TARGETS_TO_BUILD="X86" && \
    make -C /rsrc/llvm/build -j "$(nproc)" && \
    make -C /rsrc/llvm/build install && \
    make -C /rsrc/llvm/build clean && \
    rm -rf /rsrc/llvm

RUN mkdir -p /.cargo && \
    chmod 777 /.cargo

ENV RUSTFLAGS="-C linker=clang -C link-arg=-fuse-ld=/usr/local/bin/ld.lld"
```

## Building our Project

We have a project already `rust-compat-test`. To refresh, the problem we want to solve
is that we see lines like:

```sh
$ nm -u target/release/librust_compat_test.so
...
  U pthread_key_create@GLIBC_2.34
...
```

Which will throw the error we showed earlier when the library is loaded.

Let's instead build the project by running our dependencies script, then building and
running our container:

```sh
$ chmod +x build.sh
$ ./build.sh
$ docker build -t rust-compat-test-builder -f Dockerfile .
$ docker run -v "$(pwd)/rust-compat-test:/rust-compat-test" -u "$(id -u):$(id -g)" \
    -w /rust-compat-test rust-compat-test-builder cargo build
```

We'll end up with a built `target` directory in our project, so let's check the
symbols now:

```sh
$ nm -u rust-compat-test/target/debug/librust_compat_test.so
...
  U pthread_key_create
...
```

Success!

## Using In CI

This is decently useful locally, but it becomes super useful in CI when you want to
distribute this library to users. For example, you are working on a game mod whose users
[famously]() don't want to see code and just want to download a thing.
