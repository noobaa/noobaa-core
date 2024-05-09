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
%define buildroot %{_tmppath}/%{name}-%{version}-%{release}

Name: noobaa-core
Version:  %{noobaaver}
Release:  %{revision}%{?dist}
Summary:  NooBaa RPM

License:  Apache-2.0
URL:  https://www.noobaa.io/
Source0:  %{noobaatar}

BuildRequires:  systemd
BuildRequires:  python3
BuildRequires:  make
BuildRequires:  gcc-c++
BuildRequires:  boost-devel

Recommends:     jemalloc

%global __requires_exclude ^/usr/bin/python$

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

if [[ "%{CENTOS_VER}" = "8" ]]
then
  sed -i 's/\/lib64\/libboost_thread.so.1.75.0/\/lib64\/libboost_thread.so.1.66.0/g' ./src/native/s3select/s3select.gyp
  echo "Using libboost 1.66 for S3 Select"
fi

GYP_DEFINES="BUILD_S3SELECT=%{BUILD_S3SELECT} BUILD_S3SELECT_PARQUET=%{BUILD_S3SELECT_PARQUET}" npm run build

%install
rm -rf $RPM_BUILD_ROOT

mkdir -p $RPM_BUILD_ROOT/usr/local/
cp -R %{_builddir}/noobaa $RPM_BUILD_ROOT/usr/local/noobaa-core
mv %{_builddir}/node/* $RPM_BUILD_ROOT/usr/local/noobaa-core/node

mkdir -p $RPM_BUILD_ROOT/usr/local/noobaa-core/bin
ln -s /usr/local/noobaa-core/node/bin/node $RPM_BUILD_ROOT/usr/local/noobaa-core/bin/node
ln -s /usr/local/noobaa-core/node/bin/npm $RPM_BUILD_ROOT/usr/local/noobaa-core/bin/npm
ln -s /usr/local/noobaa-core/node/bin/npx $RPM_BUILD_ROOT/usr/local/noobaa-core/bin/npx

mkdir -p $RPM_BUILD_ROOT/usr/local/bin/
chmod +x $RPM_BUILD_ROOT/usr/local/noobaa-core/src/deploy/noobaa-cli
cp $RPM_BUILD_ROOT/usr/local/noobaa-core/src/deploy/noobaa-cli $RPM_BUILD_ROOT/usr/local/bin/noobaa-cli

mkdir -p $RPM_BUILD_ROOT%{_unitdir}/
mv $RPM_BUILD_ROOT/usr/local/noobaa-core/src/deploy/noobaa.service $RPM_BUILD_ROOT%{_unitdir}/noobaa.service
mkdir -p $RPM_BUILD_ROOT/etc/noobaa.conf.d/

mkdir -p $RPM_BUILD_ROOT/etc/rsyslog.d/
mv $RPM_BUILD_ROOT/usr/local/noobaa-core/src/deploy/standalone/noobaa_syslog.conf $RPM_BUILD_ROOT/etc/rsyslog.d/noobaa_syslog.conf

mkdir -p $RPM_BUILD_ROOT/etc/logrotate.d/noobaa
ln -s /usr/local/noobaa-core/src/deploy/standalone/logrotate_noobaa.conf $RPM_BUILD_ROOT/etc/logrotate.d/noobaa/logrotate_noobaa.conf
chmod +x $RPM_BUILD_ROOT/usr/local/noobaa-core/src/deploy/standalone/logrotate_noobaa.sh

%files
/usr/local/noobaa-core
%{_unitdir}/noobaa.service
/etc/logrotate.d/noobaa/logrotate_noobaa.conf
/etc/rsyslog.d/noobaa_syslog.conf
/etc/noobaa.conf.d/
/usr/local/bin/noobaa-cli
%doc

%post
state=$(systemctl show -p ActiveState --value rsyslog)
if [ "${state}" == "active" ]; then
  service rsyslog restart
fi

%changelog
* %{releasedate} NooBaa Team <noobaa@noobaa.io>
%{changelogdata}
