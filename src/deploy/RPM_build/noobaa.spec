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
%global noobaa_core_version_path .noobaa-core-%{noobaaver}

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
BuildRequires:  libcap-devel

Recommends:     jemalloc

%global __requires_exclude ^/usr/bin/python$

%description
NooBaa is a data service for cloud environments, providing S3 object-store interface with flexible tiering, mirroring, and spread placement policies, over any storage resource that allows GET/PUT including S3, GCS, Azure Blob, Filesystems, etc.

%pre
# Get the current installed version of the package
current_version=$(rpm -q --qf '%{VERSION}-%{RELEASE}' noobaa 2>/dev/null || echo "")

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
cp -R %{_builddir}/noobaa $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}
mv %{_builddir}/node/* $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/node

mkdir -p $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/bin
ln -s /usr/local/noobaa-core/node/bin/node $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/bin/node
ln -s /usr/local/noobaa-core/node/bin/npm $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/bin/npm
ln -s /usr/local/noobaa-core/node/bin/npx $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/bin/npx

mkdir -p $RPM_BUILD_ROOT/usr/local/bin/
chmod +x $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/src/deploy/noobaa-cli
cp $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/src/deploy/noobaa-cli $RPM_BUILD_ROOT/usr/local/bin/.noobaa-cli-%{noobaaver}

mkdir -p $RPM_BUILD_ROOT%{_unitdir}/
mv $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/src/deploy/noobaa.service $RPM_BUILD_ROOT%{_unitdir}/noobaa.service
mkdir -p $RPM_BUILD_ROOT/etc/noobaa.conf.d/

mkdir -p $RPM_BUILD_ROOT/etc/rsyslog.d/
mv $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/src/deploy/standalone/noobaa_syslog.conf $RPM_BUILD_ROOT/etc/rsyslog.d/noobaa_syslog.conf

mkdir -p $RPM_BUILD_ROOT/etc/logrotate.d
mv $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path}/src/deploy/standalone/noobaa-logrotate $RPM_BUILD_ROOT/etc/logrotate.d/noobaa-logrotate

%files
/usr/local/%{noobaa_core_version_path}
%{_unitdir}/noobaa.service
%config(noreplace) /etc/logrotate.d/noobaa-logrotate
%config(noreplace) /etc/rsyslog.d/noobaa_syslog.conf
/etc/noobaa.conf.d/
/usr/local/bin/.noobaa-cli-%{noobaaver}
%doc

%post
if [ -n "$current_version" ]; then
  mv $RPM_BUILD_ROOT/usr/local/noobaa-core $RPM_BUILD_ROOT/usr/local/.noobaa-core-%{current_version}
  mv $RPM_BUILD_ROOT/usr/local/bin/noobaa-cli $RPM_BUILD_ROOT/usr/local/bin/.noobaa-cli-%{current_version}
fi
mv $RPM_BUILD_ROOT/usr/local/%{noobaa_core_version_path} $RPM_BUILD_ROOT/usr/local/noobaa-core
mv $RPM_BUILD_ROOT/usr/local/bin/.noobaa-cli-%{noobaaver} $RPM_BUILD_ROOT/usr/local/bin/noobaa-cli

state=$(systemctl show -p ActiveState --value rsyslog)
if [ "${state}" == "active" ]; then
  service rsyslog restart
fi

%changelog
* %{releasedate} NooBaa Team <noobaa@noobaa.io>
%{changelogdata}
