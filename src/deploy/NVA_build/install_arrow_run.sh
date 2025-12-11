#!/bin/bash
dnf install -y epel-release
dnf install -y parquet-libs # For Apache Parquet C++
dnf clean all
