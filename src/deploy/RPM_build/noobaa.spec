# Disable debuginfo -- it does not work well with nodejs apps
%global debug_package %{nil}
# This speeds up the build a lot and it is not really required
%global __os_install_post %{nil}

%define revision null
%define noobaaver null
%define nodever null
%define releasedate null
%define changelogdata null
%define BUILD_S3SELECT null
%define BUILD_S3SELECT_PARQUET null
%define CENTOS_VER null
%define _build_id_links none

%define noobaatar %{name}-%{version}-%{revision}.tar.gz

Name: noobaa-core
Version:  %{noobaaver}
Release:  %{revision}%{?dist}
Summary:  NooBaa RPM

License:  Apache-2.0
URL:  https://www.noobaa.io/
Source0:  %{noobaatar}

BuildRequires:  python3
BuildRequires:  make
BuildRequires:  gcc-c++
BuildRequires:  nasm
BuildRequires:  boost-devel
%if 0%{?rhel} >= 9
BuildRequires:  python-unversioned-command
%endif

Recommends:     jemalloc

%description
NooBaa is a data service for cloud environments, providing S3 object-store interface with flexible tiering, mirroring, and spread placement policies, over any storage resource that allows GET/PUT including S3, GCS, Azure Blob, Filesystems, etc.

%prep
%setup -n noobaa -q

%build
NODEJS_VERSION="%{nodever}"
SKIP_NODE_INSTALL=1 source src/deploy/NVA_build/install_nodejs.sh $NODEJS_VERSION

mkdir -p ../node/

nodepath=$(download_node)
tar -xJf ${nodepath} -C ../node/

PATH=$PATH:%{_builddir}/node/node-v$NODEJS_VERSION-linux-$(get_arch)/bin

npm install --omit=dev && npm cache clean --force
./src/deploy/NVA_build/clone_s3select_submodules.sh
# Update the boost version on CentOS/RHEL 8
if [[ "%{CENTOS_VER}" = "8" ]]
then
  sed -i 's/\/lib64\/libboost_thread.so.1.75.0/\/lib64\/libboost_thread.so.1.66.0/g' ./src/native/s3select/s3select.gyp
  echo "Using libboost 1.66 for S3 Select"
fi
GYP_DEFINES="BUILD_S3SELECT=%{BUILD_S3SELECT} BUILD_S3SELECT_PARQUET=%{BUILD_S3SELECT_PARQUET}" npm run build

%install
rm -rf $RPM_BUILD_ROOT

mkdir -p $RPM_BUILD_ROOT/etc/systemd/system/
mv %{_builddir}/noobaa/src/deploy/noobaa_nsfs.service $RPM_BUILD_ROOT/etc/systemd/system/noobaa_nsfs.service
mkdir -p $RPM_BUILD_ROOT/etc/noobaa.conf.d/

mkdir -p $RPM_BUILD_ROOT/etc/rsyslog.d/
mv %{_builddir}/noobaa/src/deploy/standalone/noobaa_syslog.conf $RPM_BUILD_ROOT/etc/rsyslog.d/noobaa_syslog.conf
mv %{_builddir}/noobaa/src/deploy/standalone/noobaa_rsyslog.conf $RPM_BUILD_ROOT/etc/rsyslog.d/noobaa_rsyslog.conf

mkdir -p $RPM_BUILD_ROOT/etc/logrotate.d/noobaa
mv %{_builddir}/noobaa/src/deploy/standalone/logrotate_noobaa.conf $RPM_BUILD_ROOT/etc/logrotate.d/noobaa/logrotate_noobaa.conf

mkdir -p $RPM_BUILD_ROOT/usr/local/
mv %{_builddir}/noobaa $RPM_BUILD_ROOT/usr/local/noobaa-core
mv src/deploy/nsfs_env.env $RPM_BUILD_ROOT/usr/local/noobaa-core/nsfs_env.env
mv %{_builddir}/node/* $RPM_BUILD_ROOT/usr/local/noobaa-core/node/

mkdir -p $RPM_BUILD_ROOT/usr/local/noobaa-core/bin
ln -s ../node/bin/node $RPM_BUILD_ROOT/usr/local/noobaa-core/bin/node
ln -s ../node/bin/npm $RPM_BUILD_ROOT/usr/local/noobaa-core/bin/npm
ln -s ../node/bin/npx $RPM_BUILD_ROOT/usr/local/noobaa-core/bin/npx

%files
/usr/local/noobaa-core
/etc/systemd/system/noobaa_nsfs.service
/etc/logrotate.d/noobaa/logrotate_noobaa.conf
/etc/rsyslog.d/noobaa_rsyslog.conf
/etc/rsyslog.d/noobaa_syslog.conf
/etc/noobaa.conf.d/
%doc

%post
state=$(systemctl show -p ActiveState --value rsyslog)
if [ "${state}" == "active" ]; then
  service rsyslog restart
fi

%changelog
* %{releasedate} NooBaa Team <noobaa@noobaa.io>
%{changelogdata}
