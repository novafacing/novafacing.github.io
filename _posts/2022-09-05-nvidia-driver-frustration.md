---
layout: post
title: MOLD and NVidia and Drivers...oh god...
categories: [Linux, Debian]
---

I'm half making a note to self. I recently reinstalled Debian on my desktop (I had
switched from Ubuntu 20.04 to Debian Sid on my laptop earlier this summer), but my laptop does not have a
discrete GPU. My desktop does! All actually went well the first time I installed.

```sh
$ aptitude search '~i !~M' -F '%p' | sed "s/ *$//" | sort -u | grep nvidia
nvidia-detect
nvidia-driver
nvidia-kernel-common
nvidia-kernel-dkms
nvidia-support
nvidia-xconfig
```

So it seems I ran:

```sh
$ sudo apt-get -y install \
	nvidia-detect \
	nvidia-driver \
	nvidia-kernel-common \
	nvidia-kernel-dkms \
	nvidia-support \
	nvidia-xconfig \
```

And everything worked well, even `picom` using `gl` backend! This was fine and dandy for a week, when I
installed `mold`.

## MOLD Linker

If you haven't been paying attention, you may not know that there is a new linker in town that promises to be:

* A drop-in replacement for (`lld`/`ld.bfd`/`ld.gold`)
* *MUCH* faster than all three of those

I was having issues compiling and quickly linking large rust packages, so I decided to give `mold` a try. It's
packaged for Debian already, so installing is as simple as:

```sh
$ sudo apt-get install mold
```

I also wanted to use `mold` as my *default* linker, so I also did:

```sh
$ sudo update-alternatives --install /usr/bin/ld ld $(which mold) 100
```

If you haven't used `update-alternatives` before, it's basically a *much* smarter way to symlink programs into
your `$PATH` so that:

* You can list what you've symlinked
* You can change symlinks around
* You don't have to actually run `ln -s` ever
* Your system won't break *as* easily

And it worked awesome! As I [tweeted](https://twitter.com/novafacing/status/1565078729835126786), `mold` didn't
crash when `ld.bfd` did, and compiled some rust code about 10 times faster! Awesome!

## NVidia is broken! :(

This morning, happy with my linker *and* my graphics drivers, I noticed I had quite a lot of updates to install
and did the ususal:

```sh
$ sudo apt-get update && sudo apt-get upgrade && sudo reboot now
```

(You don't *have* to reboot after updates, but it turns out that when GL gets updated both VSCode and Kitty Terminal go bonkers).

When I logged back in I was greeted by a *very* ugly low resolution login. Obviously a driver issue. I logged in,
reinstalled `nvidia-driver` and `nvidia-kernel-dkms`, and rebooted again. No dice. I purged all my `nvidia`
packages and reinstalled them:

```sh
$ sudo apt-get purge '*nvidia*'
$ sudo apt-get install -y \
	nvidia-detect \
	nvidia-driver \
	nvidia-kernel-common \
	nvidia-kernel-dkms \
	nvidia-support \
	nvidia-xconfig \
```

*Still* no dice. This is when I started getting bad vibes and looked back through the apt logs. Turns out that
the reason for the failure is that `nvidia-kernel-dkms` failed to build the NVidia kernel module required to
run the GPU. Fair enough, but I didn't know why...except that there's really only one reason. I had a (correct)
hunch that `mold` can't handle the NVidia kernel module compilation process yet, so I reset the alternative:


```sh
sudo update-alternatives --install /usr/bin/ld ld /usr/bin/ld.bfd 101
```

And it worked! So I guess I won't be using `mold` as a symlink anymore! Instead, I recommend just adding:


```sh

LD=/usr/bin/mold
```

To your shell's `.rc` file.

