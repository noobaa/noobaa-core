#!/bin/bash
dd if=/dev/zero bs=1M count=8192 of=/swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
