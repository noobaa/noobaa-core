#!/bin/bash

dnf install -y epel-release
dnf install -y https://apache.jfrog.io/artifactory/arrow/almalinux/$(cut -d: -f5 /etc/system-release-cpe | cut -d. -f1)/apache-arrow-release-latest.rpm
dnf config-manager --set-enabled epel
dnf config-manager --set-enabled powertools || :
#parquet-devel version must match the parquet-libs version in epel
#otherwise node addon will fail to find the dependency
dnf install -y parquet-devel-8.0.0-1.el8 # For Apache Parquet C++
dnf clean all
