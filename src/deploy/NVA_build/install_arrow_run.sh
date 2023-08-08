#!/bin/bash
if [ -z "$1" ]; then
        exit 0
fi
if [ $1 -ne 1 ]; then
        exit 0
fi

dnf install -y epel-release
dnf install -y parquet-libs # For Apache Parquet C++
dnf clean all
