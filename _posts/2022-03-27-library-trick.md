---
layout: post
title: A Quick Library Trick
categories: [CTF]
---

A CTF host's worst nightmare is unintentionally not including all the files needed for
competitors to actually solve a challenge. It's annoying for hosts, annoying for competitors,
and worst of all is super easy to avoid.

Anyway, just run this!

`bash -c "ldd $BINARY | grep '=>' | cut -d' ' -f3 | xargs -I '{}' cp -L -v '{}' /build/"`
