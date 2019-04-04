%define revision dev
%define noobaaver dev
%define tarfile %{name}-NVA-%{version}-%{revision}.tar.gz
%define installscript deploy_base.sh
%define buildroot %{_tmppath}/%{name}-%{version}-%{release}

Name:		noobaa
Version:	%{noobaaver}
Release:	%{revision}%{?dist}
Summary:	noobaa rpm

License:	Apache License 2.0
URL:        https://www.noobaa.com/
Source0:	%{tarfile}
Source1:    %{installscript}

BuildArch:	noarch

Requires:	bash
Requires:	bind-utils = 32:9.9.4
Requires:   bind = 32:9.9.4
Requires:   tcpdump = 14:4.9.2
Requires:   cronie = 1.4.11
Requires:   initscripts = 9.49.46
Requires:   lsof = 4.87
Requires:   net-tools = 2.0
Requires:	openssh-server = 7.4p1
Requires:   rng-tools = 6.3.1
Requires:   rsyslog = 8.24.0
Requires:   strace = 4.12
Requires:	sudo = 1.8.23
Requires:   wget = 1.14
Requires:   dialog = 1.2
Requires:   expect = 5.45
Requires:   iperf3 = 3.1.7
Requires:   iptables-services = 1.4.21
Requires:   curl = 7.29.0
Requires:   ntp = 4.2.6p5
Requires:   nc
Requires:   vim
Requires:   less
Requires:   bash-completion
%if 0%{?centos} || 0%{?fedora}
Requires:   python-setuptools = 0.9.8
Requires:   mongodb-org = 3.6.3
Requires:   mongodb-org-server = 3.6.3
Requires:   mongodb-org-shell = 3.6.3
Requires:   mongodb-org-mongos = 3.6.3
Requires:   mongodb-org-tools = 3.6.3
%else #rhel
Requires: rh-mongodb36-mongodb = 3.6.3
Requires: rh-mongodb36-mongodb-server = 3.6.3
Requires: rh-mongodb36-mongodb-server-syspaths = 3.6.3
Requires: rh-mongodb36-mongodb-syspaths = 3.6.3
Requires: rh-mongodb36-mongo-tools = 3.6.3
Requires: rh-mongodb36-mongo-tools-syspaths = 3.6.3
Requires: atomic-openshift-clients
Requires: rhoar-nodejs10
Requires: supervisor
%endif


%description
This is noobaa rpm

%prep

%build

%install
mkdir -p %{_tmppath}/%{name}-%{version}-%{release}
cp %{SOURCE0} %{SOURCE1} %{_tmppath}/%{name}-%{version}-%{release}
cd %{_tmppath}/%{name}-%{version}-%{release}

%clean
[ ${RPM_BUILD_ROOT} != "/" ] && rm -rf ${RPM_BUILD_ROOT}

%post
echo "Starting to install noobaa"
mv %{tarfile} /tmp/noobaa-NVA.tar.gz
chmod +x %{installscript}
install -m 0755 %{installscript} %{_bindir}/%{installscript}
%{installscript} runinstall
echo -e "\e[31m\nWait for prompt and then we need to reboot...\n\e[0m"

%files
%doc

%define tmp /
%{tmp}/%{tarfile}
%{tmp}/%{installscript}

%changelog
* Thu Apr  4 2019 Liran Mauda <lmauda@redhat.com>
- Adding NooBaa Data Platform Capabilities

