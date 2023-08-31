%define revision null
%define noobaaver null
%define nodever null
%define releasedate null
%define changelogdata null

%define noobaatar %{name}-%{version}-%{revision}.tar.gz
%define nodetar node-%{nodever}.tar.xz
%define buildroot %{_tmppath}/%{name}-%{version}-%{release}

Name:		noobaa-core
Version:	%{noobaaver}
Release:	%{revision}%{?dist}
Summary:	NooBaa RPM

License:	Apache-2.0
URL:        https://www.noobaa.io/
Source0:	%{noobaatar}
Source1:    %{nodetar}

Recommends: jemalloc

%global __os_install_post %{nil}

%global __requires_exclude ^/usr/bin/python$

%description
NooBaa is a data service for cloud environments, providing S3 object-store interface with flexible tiering, mirroring, and spread placement policies, over any storage resource that allows GET/PUT including S3, GCS, Azure Blob, Filesystems, etc.

%prep
mkdir noobaa-core-%{version}-%{revision}
mkdir node-%{nodever}
tar -xzf %{SOURCE0} -C noobaa-core-%{version}-%{revision}/
tar -xJf %{SOURCE1} -C node-%{nodever}/

%clean
[ ${RPM_BUILD_ROOT} != "/" ] && rm -rf ${RPM_BUILD_ROOT}

%install
rm -rf $RPM_BUILD_ROOT
mkdir -p $RPM_BUILD_ROOT/usr/local/

cp -R %{_builddir}/%{name}-%{version}-%{revision}/noobaa $RPM_BUILD_ROOT/usr/local/noobaa-core
cp -R %{_builddir}/node-%{nodever}/* $RPM_BUILD_ROOT/usr/local/node

mkdir -p $RPM_BUILD_ROOT/usr/bin/
ln -s /usr/local/node/bin/node $RPM_BUILD_ROOT/usr/bin/node
ln -s /usr/local/node/bin/npm $RPM_BUILD_ROOT/usr/bin/npm
ln -s /usr/local/node/bin/npx $RPM_BUILD_ROOT/usr/bin/npx

mkdir -p $RPM_BUILD_ROOT/etc/systemd/system/
ln %{_builddir}/%{name}-%{version}-%{revision}/noobaa/src/deploy/nsfs.service $RPM_BUILD_ROOT/etc/systemd/system/nsfs.service


%files
/usr/local/noobaa-core
/usr/local/node
/usr/bin/node
/usr/bin/npm
/usr/bin/npx
/etc/systemd/system/nsfs.service
%doc

%post
if [ $1 -gt 1 ]; then
  NOOBAA_RPM_BASE_PATH="$RPM_BUILD_ROOT/usr/local/noobaa-core"
  pushd $NOOBAA_RPM_BASE_PATH

  UPGRADE_SCRIPTS_DIR=/root/node_modules/noobaa-core/src/upgrade/upgrade_scripts
  echo "Running /usr/local/node/bin/node src/upgrade/upgrade_manager.js --upgrade_scripts_dir ${UPGRADE_SCRIPTS_DIR}"
  /usr/local/node/bin/node src/upgrade/upgrade_manager.js --upgrade_scripts_dir ${UPGRADE_SCRIPTS_DIR}
  rc=$?
  if [ ${rc} -ne 0 ]; then
    echo "upgrade_manager failed with exit code ${rc}"
    exit ${rc}
  fi
fi

%changelog
* %{releasedate} NooBaa Team <noobaa@noobaa.io>
%{changelogdata}
