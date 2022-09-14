---
layout: post
title: Binary Golf Grand Prix 3 Submission (200k crashes in clang15.0.0)
categories: [Research,Competition,Binaries,Triaging]
---

This post plus the code mentioned in it is available [here](https://github.com/novafacing/bggp3).

This is my submission for [BGGP3](https://tmpout.sh/bggp/3/)! I really wanted
to play this year, but for months and months I either didn't have time or didn't
find any bugs I thought were "fun enough" (or had short enough payloads) to submit.

```
Clang version: Debian clang version 15.0.0-++20220625103012+3d37e785c77a-1~exp1
```


Well, tonight I was working on my
[patching tool](https://github.com/novafacing/pypatches) and found something neat!
A current version clang crash with no extra libraries loaded! In fact, this crash
happens with *any* C program used as input, and only requires one argument to get
into an unrecoverable state. Fun!

## How I found the crash(es)

I happened upon this crash on accident, but before we get to that, some background.  As it turns out, it's actually
pretty hard to distill *any possible computer* down to a command line option, because there
are *tons* of possibilities. If you've ever built a computer, just think of how you felt
looking at all the components you could buy and all the ways you could put them
together. Now think of all the ways *servers* can be configured. It's a lot!

Lets say for example I want to emit machine code for an x86 32-bit machine. 
Currently, Intel, AMD, VIA, and Zhaoxin produce x86 processors. So that is four vendors
of the x86 processor. Although according to
[wikipedia](https://en.wikipedia.org/wiki/List_of_x86_manufacturers) there have been
over 30 companies making x86 chips historically (most famously IBM). There are three
other (well, four, but we'll just talk about three as a simplification) parts of what
`clang` (and to some extent `gcc`) call *triples* which are combinations of strings used
to describe a *target*. A target is an abstraction of a specific machine -- if the
compiler emits machine code for an abstraction of a specific machine, it should run on
any machine that conforms to the triple that describes it. Here's what a triple looks
like:

```txt

    ┌──│Architecture
    │    ┌─────────│Vendor
    │    │  ┌────────────│Operating System
    │    │  │     ┌──────────────────────│Environment
    │    │  │     │
    i386-pc-linux-gnu
```

I mentioned x86. That's just one architecture, and `clang` supports at least 100 others
including ARM, MIPS, and some you may not have heard of like xscale. That's already a
lot of possibilities, but there are also 15 vendors (like NVidia, apple, and the generic
"pc"), 39 operating systems including Linux, Windows, and Darwin but also Playstation 5,
and 36 environments with some expected like GNU, but some not like "vertex" and
"geometry". Environment is sort of a "catch-all" part of the triple. You would think
that with so many choices, there would have to be a list somewhere, right? Wrong! In
fact, `clang` doesn't even have a reliable way to list all of the parts of a triple,
let alone all possible triples. Luckily for us, `clang` is not closed source software,
and we can find all the code used to implement the triple system in
[Triple.cpp](https://github.com/llvm/llvm-project/blob/main/llvm/lib/Support/Triple.cpp)
. And if we take the product of every *possible* (note for later: not necessarily valid!)
triple, we end up with...*2,275,432* triples.

Oof! 😮‍💨

Of course, `clang` doesn't provide a way to see if a given triple, like...
`i386-apple-amdpal-cygnus` is valid (it is, somehow?). The only way to see if you can
emit code for a target is to try it, and if it works, you can emit code for it. So I
went ahead and wrote a loop that subprocesses out to `clang` with every possible triple
and compiles `int main() { return 1; }` with a given triple. About as simple as it gets.
I expected a lot of these to fail, but what I didn't really expect was to get *tons* of
tracebacks out of clang. I've been writing LLVM passes and compilers using LLVM for a
while and I know that it's not super stable to program against, but I was always under
the impression that the command line `clang` invocations would not generally crash. Turns
out it's just really hard to predict command line options when you have that many
possibilities. To be fair, nobody really wants to target Apple as a vendor on the Cygnus
CPU, hopefully.

## Crashing clang

We can crash clang with a one-liner, assuming you have `clang15.0.0` installed (you can
check with `clang --version`). Older `clang`s might still work, but I haven't checked
them. 

`$ clang -target i386-apple-windows-eabi <<< "int main(){}"`

You should see a pretty long traceback, meaning we caused a segmentation fault!

## Triaging the crash

We can dig into the crash a bit in `gdb` (notice I'm using
[pwndbg](https://github.com/pwndbg/pwndbg)), and find out where we crash with:

```sh
$ cat > /tmp/tmpb_p6ql7rbggp3.crash.c <<< "int main(){}"
$ gdb -q
pwndbg> file /usr/bin/clang-15
pwndbg> r -cc1 -triple i386-apple-windows-eabi -emit-obj -mrelax-all --mrelax-relocations -disable-free -clear-ast-before-backend -disable-llvm-verifier -discard-value-names -main-file-name tmpb_p6ql7rbggp3.crash.c -mrelocation-model static -mframe-pointer=all -fmath-errno -ffp-contract=on -fno-rounding-math -mconstructor-aliases -funwind-tables=2 -target-cpu i686 -tune-cpu generic -mllvm -treat-scalable-fixed-error-as-warning -debugger-tuning=gdb  -resource-dir /usr/lib/llvm-15/lib/clang/15.0.0  -ferror-limit 19 -fno-use-cxa-atexit -fgnuc-version=4.2.1 -fcolor-diagnostics -faddrsig -o /tmp/tmpb_p6ql7rbggp3-e56cf8.o -x c /tmp/tmpb_p6ql7rbggp3.crash.c
pwndbg> where
#0  0x00007fffefb9a982 in llvm::MCWinCOFFStreamer::emitCGProfileEntry(llvm::MCSymbolRefExpr const*, llvm::MCSymbolRefExpr const*, unsigned long) () from /usr/lib/llvm-15/bin/../lib/libLLVM-15.so.1
```

Great! We know where, so now we can set a breakpoint on this function and see *why*.

```sh
pwndbg> b llvm::MCWinCOFFStreamer::emitCGProfileEntry(llvm::MCSymbolRefExpr const*, llvm::MCSymbolRefExpr const*, unsigned long) 
Breakpoint 1 at 0x7fffefb9a970
pwndbg> r -cc1 -triple i386-apple-windows-eabi -emit-obj -mrelax-all --mrelax-relocations -disable-free -clear-ast-before-backend -disable-llvm-verifier -discard-value-names -main-file-name tmpb_p6ql7rbggp3.crash.c -mrelocation-model static -mframe-pointer=all -fmath-errno -ffp-contract=on -fno-rounding-math -mconstructor-aliases -funwind-tables=2 -target-cpu i686 -tune-cpu generic -mllvm -treat-scalable-fixed-error-as-warning -debugger-tuning=gdb  -resource-dir /usr/lib/llvm-15/lib/clang/15.0.0  -ferror-limit 19 -fno-use-cxa-atexit -fgnuc-version=4.2.1 -fcolor-diagnostics -faddrsig -o /tmp/tmpb_p6ql7rbggp3-e56cf8.o -x c /tmp/tmpb_p6ql7rbggp3.crash.c
```

We should now be at the start of the function that broke, and if you saw the disassembly
above, you'll know the breakage isn't that far into the function.

```asm
push   rbp
push   r15
push   r14
push   r13
push   r12
push   rbx
sub    rsp, 0x18
mov    rax, qword ptr [rsi + 0x10]
test   byte ptr [rax + 8], 1
```

That last instruction is what breaks, because it tries to dereference `rax+8`, but that
dereference is an invalid pointer. We can
actually see what's in `rax` at the entry
to this function:

```sh
pwndbg> p (char *)$rax
$2 = 0x555555689198 "Debian clang version 15.0.0-++20220625103012+3d37e785c77a-1~exp1"
```

## Triaging a lot of crashes

Well, that's interesting! We won't be able to control the program counter to get a "3"
into it and we won't be able to hijack execution and print or return "3" without
recompiling clang with a different version string (which we could definitely do!).

Or...will we? We only tried one triple, what if other triples crash clang in different
and possibly nastier ways? Only one way to find out...let's enumerate every triple and
grab the stack traces from all of them! The code is pretty long, but you can check
it out [here](try_triples.py). It did take a while to run, 3 hours on one core on my
laptop which is only ~210 exec/s. That doesn't seem very good, but is mostly due to the
fact that clang is really good at error recovery (it spits out its *own* stack trace),
which requires it to use C++ exceptions. If you're a googler or know a googler...you
know that C++ exceptions are slow. So, I'm pretty okay with how fast this runs!

Turns out if we just check to see if we get a traceback, 233,246 of those 2,275,432
triples spit out a traceback. I could call that 233,246 crashes and be pretty satisfied
with this BGGP3 submission, but:

1. I don't have RIP control still
2. A lot of those are clang intentionally throwing an error when it realizes the triple
   isn't valid.

We need to categorize all these triples! If we write a quick script, we can just dump all
the stack traces, remove any addresses, and then see how many we get:


```python
"""
Analyze the results of checking triples from results.txt
"""

from pathlib import Path
from re import findall
from more_itertools import chunked
from ast import literal_eval


def main() -> None:
    """
    Open the results file, grab the output of each crash, and
    sort based on the backtrace to minimize the test cases
    """
    results = Path("./results.txt").read_text(encoding="utf-8", errors="ignore")
    stack_traces = {}

    STACK_TRACE_RE = rb"\#[0-9]+\s+0x[0-9a-f]+\s+([a-zA-Z_0-9:]+)"

    for result, output_string in chunked(results.splitlines(), 2):
        strace = (*findall(STACK_TRACE_RE, literal_eval(output_string)),)
        if strace not in stack_traces:
            print(strace)
        stack_traces[strace] = (result, literal_eval(output_string))

    print(len(stack_traces))


if __name__ == "__main__":
    main()
```


If we run this, we end up with 11 (really 10) stack traces with the following crashing
functions:

1. [`llvm::MCWinCOFFStreamer::emitCGProfileEntry`](https://github.com/llvm/llvm-project/blob/fbd2950d8d0dd0ad953b439374237497b47d2ecf/llvm/lib/MC/MCWinCOFFStreamer.cpp#L340) (`x86_64h-windows-amplification`)
2. [`clang::driver::ToolChain::~ToolChain`](https://github.com/llvm/llvm-project/blob/06fc5a7714621324b121fb3ee03ac15eb018cf99/clang/lib/Driver/ToolChain.cpp#L97) (`shadermodel`)
3. [`llvm::raw_svector_ostream::write_impl`](https://github.com/llvm/llvm-project/blob/de9d80c1c579e39cc658a508f1d4ba1cd792e4d5/llvm/lib/Support/raw_ostream.cpp#L949) (`solaris`)
4. [`clang::driver::ToolChain::ToolChain`](https://github.com/llvm/llvm-project/blob/06fc5a7714621324b121fb3ee03ac15eb018cf99/clang/lib/Driver/ToolChain.cpp#L75) (`dxil-windows-itanium`)
5. [`llvm::StringRef::find`](https://github.com/llvm/llvm-project/blob/fbd2950d8d0dd0ad953b439374237497b47d2ecf/llvm/include/llvm/ADT/StringRef.h#L319) (`dxil-oe-windows-gnu`)
6. [`lld::elf::getErrorPlace`](https://github.com/llvm/llvm-project/blob/c72973608d034e7222957b1cb2f712ddbca8c253/lld/ELF/Target.cpp#L94) (`systemz-amdpal`)
7. [`clang::driver::Driver::BuildJobsForActionNoCache`](https://github.com/llvm/llvm-project/blob/549542b494f4c84bead744ed91ea81236e4aaa63/clang/lib/Driver/Driver.cpp#L5233) (`windows-itanium`)
8. [`lld::elf::getTarget`](https://github.com/llvm/llvm-project/blob/c72973608d034e7222957b1cb2f712ddbca8c253/lld/ELF/Target.cpp#L50) (`sparcel-amdpal`)
9. [`llvm::MCAsmBackend::createObjectWriter`](https://github.com/llvm/llvm-project/blob/2a4625530fb68bd5b7cf0d61372e93beaf053444/llvm/lib/MC/MCAsmBackend.cpp#L32) (`nvptx64-shadermodel`)

## Triaging these :bug:s

Still a few but a lot better than 200k. We can probably safely assume that there are
just a ton of duplicates of these same 9 crashes and go ahead and move on to triaging
them! We already triaged the first bug in `emitGCProfileEntry` and figured that we can't
get IP control out of it without unreasonable shenanigans, but we will try the rest.

### Bug 2

Starting from #2, the triple `shadermodel` just throws an unknown target triple error,
so that isn't even really a crash. Passing `solaris` is interesting, because the actual
error is LLVM out of memory! This is pretty unexpected, and it turns out that LLVM is
trying to get the status of a non-existent file
`/usr/lib/llvm-15/lib/clang/15.0.0/lib/unknown-unknown-solaris` and...runs OOM in there
somewhere. Once again, there wasn't much of a path to RIP control here. 

### Bugs 3, 4, and 5

Next, the crash in `ToolChain::ToolChain` happens when constructing a `basic_string`
in `_M_create(size_type& __capacity, size_type __old_capacity)`. The crash itself is
interesting, because it tries to create a string with a much too large size, but the
size isn't well controlled and besides, we want to control contents more than a size.
Next, if we check out the `StringRef::find` crash, we see it originates from
`Triple::getArchName()`. The only line therein is `StringRef(Data).split('-').first;`
which is a little odd -- you would think there would be some validation of the triple to
make sure it is valid, but as we discussed that type of support is a bit lacking.

### Bug 6

The
next crash in `getErrorPlace` stems from `lld::elf::LinkerDriver::linkerMain`, but the
error reported by clang is a segmentation fault. In addition to tracebacks, `clang` has
another neat trick: passing `-v` will allow you to replicate runs using the internal
`clang` command argument.

First, we have a `cc` argument:

```sh
 "/usr/lib/llvm-15/bin/clang" -cc1 -triple systemz-unknown-amdpal -emit-obj -mrelax-all --mrelax-relocations -disable-free -clear-ast-before-backend -disable-llvm-verifier -discard-value-names -main-file-name tmpa9zv_lzo.c -mrelocation-model static -mframe-pointer=all -ffp-contract=on -fno-rounding-math -mconstructor-aliases -fvisibility hidden -fapply-global-visibility-to-externs -target-cpu z196 -mllvm -treat-scalable-fixed-error-as-warning -debugger-tuning=gdb -v -fcoverage-compilation-dir=/home/novafacing/hub/bggp3 -resource-dir /usr/lib/llvm-15/lib/clang/15.0.0 -fdebug-compilation-dir=/home/novafacing/hub/bggp3 -ferror-limit 19 -fmessage-length=111 -fno-signed-char -fgnuc-version=4.2.1 -fcolor-diagnostics -faddrsig -o /tmp/tmpa9zv_lzo-cc5552.o -x c /tmp/tmpa9zv_lzo.c
```

This will create the `.o` file we are looking for, a 760 byte object file. We can also
directly run the crashing linker command:


```sh
"/usr/lib/llvm-15/bin/ld.lld" /tmp/tmpa9zv_lzo-cc5552.o -shared -o /dev/null
```

This one was especially interesting because the crash is in the linker, `ldd`, not in
`clang` proper -- we've now crashed two programs with the same series of morphed CLI
options! If we run this with GDB, we'll see we crash in
`lld::elf::getErrorPlace(unsigned char const *)` with a dereference of `rbp` which is
0 here. Sadly, this once again doesn't have an easy path to exploitation, because a null
pointer dereference isn't super useful. There is an option to try and get a controlled
write of a NULL to a controlled location, however. If we could control `rbp`, we would
be able to write a 0 to that location. We'll save this for later and continue triaging
the rest of our bugs.

```
0x5555557f1dea    mov    qword ptr [rbp], 0
```

### Bug 7

This one is pretty interesting. We crash in:

```
0x7ffff689c1d3    movsxd rcx, dword ptr [rdx + rcx*4]
```

With `rdx=0x7ffff76d3f68` (A code address in libclang-cpp.so.15) and `rcx=0xffffffff`
(32-bit -1). My first thought is this might be a negative array index, which would be
pretty interesting indeed.

### Bug 8

This one crashes `ld.lld` as well:

```
0x5555557f1bd0 <lld::elf::getTarget()+32>           movsxd rax, dword ptr [rdx + rax*4]
```

With `rax=0xffffffff` and `rdx=0x55555597975c` (a code address again). Once again, this
smells like negative indexing!

### Bug 9

This final bug is actually in the CC assembler which we haven't looked at, and is triggered
with:

```sh
$ "/usr/lib/llvm-15/bin/clang" -cc1 -triple nvptx64-unknown-shadermodel -S -disable-free -clear-ast-before-backend -disable-llvm-verifier -discard-value-names -main-file-name x.c -mrelocation-model static -mframe-pointer=all -fmath-errno -ffp-contract=on -fno-rounding-math -fno-verbose-asm -no-integrated-as -target-feature +ptx42 -mllvm -treat-scalable-fixed-error-as-warning -debugger-tuning=gdb -fno-dwarf-directory-asm -v -resource-dir /usr/lib/llvm-15/lib/clang/15.0.0 -fdebug-compilation-dir=/home/novafacing/hub/bggp3 -ferror-limit 19 -fmessage-length=111 -fgnuc-version=4.2.1 -fcolor-diagnostics -o /tmp/x-27ab5d.s -x c /tmp/x.c
$ "/usr/lib/llvm-15/bin/clang" -cc1as -triple nvptx64-unknown-shadermodel -filetype obj -main-file-name x.c -target-feature +ptx42 -fdebug-compilation-dir=/home/novafacing/hub/bggp3 -dwarf-version=5 -mrelocation-model static -mrelax-all --mrelax-relocations -o /tmp/x-a739fb.o /tmp/x-27ab5d.s
$ /usr/lib/llvm-15/bin/clang -cc1as -triple nvptx64-unknown-shadermodel -filetype obj -main-file-name x.c -target-feature +ptx42 -fdebug-compilation-dir=/home/novafacing/hub/bggp3 -dwarf-version=5 -mrelocation-model static -mrelax-all --mrelax-relocations -o /tmp/x-a739fb.o /tmp/x-27ab5d.s
```

This one is a null pointer dereference: 

```
0x7fffefb39690    mov    rax, qword ptr [rsi]
```

Where `rax=0x461b5d021351e300` and `rsi=0x0`.

## Getting a `3` printed

Well, we looked at all the crash locations, and none of them have a clear *easy* way to get
a `3` to print or get into `rip`. Unfortunately, I am also too busy to fanagle any of
these bugs into a workable state to get that printed out.

## Conclusion

Hope you enjoyed this dive into clang Triples. If you're a clang dev, these are clearly
not super high priority fixes, but arg checking would be nice to have. If you're not,
you can take a lesson from this! When allowing arguments to your program, prefer to
"fail fast", that is only combinations of arguments that really are valid should make
it to any code beyond the argument validation process. Happy hacking!