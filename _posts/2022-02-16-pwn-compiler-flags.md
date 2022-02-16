---
layout: post
title: Linux Security Options and Compiler Flags
categories: [CTF]
---

Here's a short overview of available security options on Linux and how to enable or disable them.

To check security flags, I suggest using `checksec` which can be installed with `python3 -m pip install checksec.py` 
and run with `python3 -m checsec <binary>`.

## Security Flags

The primary binary security options that can be enabled (on Linux) are:

* `NX`
* `PIE`
* `Canary`
* `RELRO`
* `FORTIFY`

## NX

### Flags

NX is enabled by default, and can be disabled with:

`-z execstack`

### Functionality

`NX` means Non-eXecutable stack, and is used to prevent attacks where shellcode is injected into stack memory, for
example via buffer overflow.

## PIE

### Flags

PIE is enabled by default, and can be disabled with:

`-no-pie`

### Functionality

`PIE` means Position Independent Execution, and is used to randomize the address space of the program each time it is
run, which helps to prevent some code reuse attacks such as Ret2Libc and ROP. `PIE` depends on `ASLR` to work correctly
and works with `ASLR` 

## Canary

### Flags

Stack canaries are enabled by default, and can be disabled with:

`-fno-stack-protector`

This will enable stack protectors in all functions with stack buffers (like `char buf[0x10]`). Stack protectors can
be enabled in all functions with:

`-fstack-protector-all`

### Functionality

Stack canaries are used to detect buffer overflows upon return from a function, and performs a check that halts
execution of the program to prevent malicious code execution.

## RELRO

### Flags

Full RELRO can be enabled with:

`-Wl,-z,now -Wl,-z,relro`

### Functionality

RELRO is short for RELocatable Read Only. There are two levels of RELRO:

* Partial RELRO moves the `.got` section of the binary below the `.bss` section in the binary so that overflows of
    global variables will not overwrite `.got` entries. This setting is applied to almost all binaries, but it is not
    particularly powerful at preventing exploits (and prevents different types of exploits from full RELRO).
* Full RELRO causes the entire `.got` section of the binary to be marked as read only, and implicitly enables 
    `LD_BIND_NOW` when the binary starts. This prevents `.got` overwrite attacks (unless program memory is re-protected)
    .

## FORTIFY

### Flags

Fortify can be enabled with:

`-O1 -D_FORTIFY_SOURCE=1`

Or

`-O2 -D_FORTIFY_SOURCE=2`

### Functionality

FORTIFY adds overflow checks to libary functions:

* `memcpy`
* `mempcpy`
* `memmove`
* `memset`
* `strcpy`
* `stpcpy`
* `strncpy`
* `strcat,`
* `strncat`
* `sprintf`
* `vsprintf`
* `snprintf`
* `vsnprintf`
* `gets`

These overflow checks check source copy sizes to determine whether the buffer will overflow, and aborts execution if it
does.
