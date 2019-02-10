#!/bin/bash

SWAP_SIZE_MB=6144

if grep -q PLATFORM=azure /data/.env; then
  if grep -q EnableSwap=n /etc/waagent.conf; then
    /sbin/swapoff -a
    sed -i "s:ResourceDisk.EnableSwap=n:ResourceDisk.EnableSwap=y:" /etc/waagent.conf
    sed -i "s:ResourceDisk.SwapSizeMB=0:ResourceDisk.SwapSizeMB=${SWAP_SIZE_MB}:" /etc/waagent.conf
    service waagent restart
  fi
elif [ "${container}" != "docker" ]; then
  if ! grep -q swapfile /etc/fstab; then
    swapon -s
    dd if=/dev/zero bs=1M count=${SWAP_SIZE_MB} of=/swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo "/swapfile swap  swap  sw  0 0" >> /etc/fstab
  fi
fi