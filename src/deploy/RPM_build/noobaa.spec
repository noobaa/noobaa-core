%define revision null
%define noobaaver null
%define nodever null
%define releasedate null
%define changelogdata null
%define BUILD_S3SELECT null
%define BUILD_S3SELECT_PARQUET null
%define CENTOS_VER null

%define noobaatar %{name}-%{version}-%{revision}.tar.gz
%define buildroot %{_tmppath}/%{name}-%{version}-%{release}

Name: noobaa-core
Version:  %{noobaaver}
Release:  %{revision}%{?dist}
Summary:  NooBaa RPM

License:  Apache-2.0
URL:  https://www.noobaa.io/
Source0:  %{noobaatar}

Recommends: jemalloc

%global __os_install_post %{nil}

%global __requires_exclude ^/usr/bin/python$

%description
NooBaa is a data service for cloud environments, providing S3 object-store interface with flexible tiering, mirroring, and spread placement policies, over any storage resource that allows GET/PUT including S3, GCS, Azure Blob, Filesystems, etc.

%prep
mkdir noobaa-core-%{version}-%{revision}
mkdir node-%{nodever}
tar -xzf %{SOURCE0} -C noobaa-core-%{version}-%{revision}/

%clean
[ ${RPM_BUILD_ROOT} != "/" ] && rm -rf ${RPM_BUILD_ROOT}

%build
#!/bin/bash
NOOBAA_DIR="noobaa-core-%{version}-%{revision}"
NODEJS_VERSION="%{nodever}"
SKIP_NODE_INSTALL=1 source $NOOBAA_DIR/noobaa/src/deploy/NVA_build/install_nodejs.sh $NODEJS_VERSION

pushd %{_sourcedir}
nodepath=$(download_node)
tar -xJf ${nodepath} -C %{_builddir}/node-%{nodever}/
popd

PATH=$PATH:%{_builddir}/node-%{nodever}/node-v$NODEJS_VERSION-linux-$(get_arch)/bin

pushd $NOOBAA_DIR/noobaa
npm install --omit=dev && npm cache clean --force
./src/deploy/NVA_build/clone_s3select_submodules.sh
if [[ "%{CENTOS_VER}" = "8" ]]
then
  sed -i 's/\/lib64\/libboost_thread.so.1.75.0/\/lib64\/libboost_thread.so.1.66.0/g' ./src/native/s3select/s3select.gyp
  echo "Using libboost 1.66 for S3 Select"
elif [[ "%{CENTOS_VER}" = "9" ]]
then
  echo "Using libboost 1.75 for S3 Select"
else
  echo "Unexpected CENTOS_VER: %{CENTOS_VER}"
  exit 1
fi
GYP_DEFINES="BUILD_S3SELECT=%{BUILD_S3SELECT} BUILD_S3SELECT_PARQUET=%{BUILD_S3SELECT_PARQUET}" npm run build
popd

%install
rm -rf $RPM_BUILD_ROOT
mkdir -p $RPM_BUILD_ROOT/usr/local/

cp -R %{_builddir}/%{name}-%{version}-%{revision}/noobaa $RPM_BUILD_ROOT/usr/local/noobaa-core
cp -R %{_builddir}/node-%{nodever}/* $RPM_BUILD_ROOT/usr/local/noobaa-core/node

mkdir -p $RPM_BUILD_ROOT/usr/local/noobaa-core/bin
ln -s /usr/local/noobaa-core/node/bin/node $RPM_BUILD_ROOT/usr/local/noobaa-core/bin/node
ln -s /usr/local/noobaa-core/node/bin/npm $RPM_BUILD_ROOT/usr/local/noobaa-core/bin/npm
ln -s /usr/local/noobaa-core/node/bin/npx $RPM_BUILD_ROOT/usr/local/noobaa-core/bin/npx

mkdir -p $RPM_BUILD_ROOT/etc/systemd/system/
cp -R %{_builddir}/%{name}-%{version}-%{revision}/noobaa/src/deploy/noobaa_nsfs.service $RPM_BUILD_ROOT/etc/systemd/system/noobaa_nsfs.service
ln -s /usr/local/noobaa-core/src/deploy/nsfs_env.env $RPM_BUILD_ROOT/usr/local/noobaa-core/nsfs_env.env
mkdir -p $RPM_BUILD_ROOT/etc/noobaa.conf.d/

mkdir -p $RPM_BUILD_ROOT/etc/rsyslog.d/
ln -s /usr/local/noobaa-core/src/deploy/standalone/noobaa_syslog.conf $RPM_BUILD_ROOT/etc/rsyslog.d/noobaa_syslog.conf
ln -s /usr/local/noobaa-core/src/deploy/standalone/noobaa_rsyslog.conf $RPM_BUILD_ROOT/etc/rsyslog.d/noobaa_rsyslog.conf

mkdir -p $RPM_BUILD_ROOT/etc/logrotate.d/noobaa
ln -s /usr/local/noobaa-core/src/deploy/standalone/logrotate_noobaa.conf $RPM_BUILD_ROOT/etc/logrotate.d/noobaa/logrotate_noobaa.conf

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
