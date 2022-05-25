---
layout: post
title: Converting glibc types to angr SimTypes
categories: []
---

I did [some work](https://github.com/angr/angr/pull/3350) this week converting some
types that were missing in [angr](https://github.com/angr/angr.git) from their C
definitions in [glibc](https://github.com/bminor/glibc.git) into a type specification
in Python that can be used in angr for type analysis and more importantly, to make
writing `SimProcedures` easier.

## An aside on SimProcedures

If you don't know what a `SimProcedure` is, it's not really relevant for the rest of
this post, but it's pretty cool. Basically, `angr` is smart enough that while it is
running, it knows the entire linkage information of your binary (this is because
`cle`, a component of `angr`, *is* the linker). This lets it know when it is about to
call any library code pretty easily. Because library functions are pretty
[complex](https://github.com/bminor/glibc/blob/master/stdio-common/vfprintf-internal.c),
they aren't really a great idea to run under symbolic execution because there's just a
*lot* of code. The upside is that we really kind of know what every library function
does, because they're the basis of most code. So instead of running the machine code
for that library function, we can emulate its behavior with a much smaller function
written in Python and update our state of the program accordingly.

For example, the below would be an example of a bad way to write memcpy:

```python
class memcpy(angr.SimProcedure):
    """
    Simprocedure for memcpy library function
    """

    def run(self, dst: BV, src: BV, sz: BV) -> BV:
        """
        Copy n bytes from src to dest and return a pointer to
        dest.

        :param dst: The destination of the copy
        :param src: The source of the copy
        :param sz: The size of the copy
        """
        if sz.concrete:
            m_sz = self.state.solver.eval_one(sz)
        else:
            m_sz = 1024

        state.memory.store(dst, state.memory.load(src, m_sz), m_sz)
        return dst
```

Notice that this (kind of) works whether the size is concrete or symbolic. This is
awesome! It runs super fast, doesn't go into any of the weird vectorized copy logic
that `memcpy` uses to run *faster*, and in fact that is totally fine because symbolically
executing that optimized code is likely slower than symbolically executing the dumbest
possible memcpy, and this `SimProcedure` is faster than both!

## Sadly, glibc.

Anyway, so libc has about 650 public functions, a lot more private functions, and
a whole lot of structs (probably less than the number of private functions but much
more than the number of public ones!). It is also, if you have ever dug into it,
a *complete* mess.

There is a lot of...this:

```c
// From sysdeps/unix/sysv/linux/bits/timex.h
<...snip...>
  int tai;			/* TAI offset (ro) */

  /* ??? */
  int  :32; int  :32; int  :32; int  :32;
  int  :32; int  :32; int  :32; int  :32;
  int  :32; int  :32; int  :32;
```

I'm not...really sure what that is supposed to be, and it doesn't seem like the
maintainers do either. This is usually fine as an end user of the library. You
can call a function that populates a `timex` struct, grab the data you want out
of it, and go on your merry way without ever caring that there are eleven
`uint32_t` on the back of that struct for no apparent reason.

But when writing analysis tooling we do unfortunately need to care about these things.
Sad! This means, of course that my first attempt at looking for struct definitions
was terrible.

## How not to get struct definitions

The first way you should not try to get structs is from
[gnu.org](https://www.gnu.org/software/libc/manual/html_mono/libc.html). I thought
that this would be the ideal place. All the function prototypes and struct definitions,
all on one page! Unfortunately, *this is not true* and they *don't tell you that*!

If you CTRL+F on this page for the phrase "Data Type:" you will get a lot of what
look like struct definitions, and if you (like me) like Sphinx, they will look
a lot like what is tossed out of an autodoc.

They are not.

This is all handwritten! And that means two things:

1. There are errors. Many data types are straight up incorrect for struct members.
   Many more struct members are simply missing from their struct descriptions. Even
   more are *in the wrong order*. Remember when I said "unfortunately" we have to care
   about these things?
2. Because humans were asked to write this documentation, some humans...did not.
3. Structs internal to glibc and crucially, data types internal to glibc, are
   generally not documented at all here because you the user are not supposed
   to have to care about them.

So, yeah. We can't use this, we can't use the html docs, and we don't have sphinx for C
because for some reason glibc is still a thing that is able to justify not being documented
correctly despite being called into by like...90% of code currently running on planet earth. That's okay though, because unlike on the blockchain, the code can't lie!

That said, you should not google the structs and go to the first link, because it will be
old code, forked code, architecture specific code, inexplicably code from chromium despite
it being a browser and most certainly not glibc, or something like that.

## How to get struct definitions

First, go ahead and clone glibc. You can clone it from the ftp `gnu.org` provides, or
you can be lame like me and download from [my hero bminor](https://github.com/bminor/glibc.git).

We're going to use a combination of two tools to find all these definitions. Disclaimer,
I did not find *all* the definitions in glibc using this pair of tools, but I found
everything needed to create the structs for every glibc SimProcedure which I believe is
its entire public API.

### Tool 1: ag

`ag` is glorified grep, but it is actually good for searching code, while grep is...okay.

To search code, simply go to `glibc` and type `ag "_IO_codecvt"`. You won't get *that*
much stuff, and you could easily comb through those files to figure out which one defines
the struct. As far as I can tell, the order you should check the set of header files
that appear is:

* Check files in `sysdeps` first.
* Check files in `bits` next.
* Check files that aren't public headers next.
* Check public headers.

This definitely isn't always true, but it mostly seemed to work for me. Once you find the
struct definition, just copy the link and move on. It was much easier once I started just
grabbing all the links and then went back and wrote all the structs down later.

### Tool 2: Github File Search

On Github, if you are in a repo there will be a button toward the top right that says
"Go To File". This button *rocks*. I wish my search in `nautilus` was this good, seriously.

Click that, and type in the name of the struct you want. Often there will be a
`struct_yourstruct.h` file somewhere and bingo. Other things, you can probably guess where
they are defined, for example `hsearch_data` is defined in `search.h`.

This is what I used for probably 90% of the finds, with `ag` bringing up the rear when the first four results on GFS didn't bring anything up.

Hopefully this helps someone find some structs!


