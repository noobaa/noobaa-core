#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
toInclude=true
remount=false
sudo="sudo"

OPTIONS=$( getopt -o 'h,e,r' --long "help,exclude,remount" -- "$@" )
eval set -- "${OPTIONS}"

function usage(){
    echo "$0 [options]"
    echo "-e --exclude run this script in exclude mode\
    (the mounts will be named exclude)"
    echo "-r --remount will remount the last disk to exclude directory"
    echo "-h --help will show this help"
    exit 0
}

while true
do
    case ${1} in
		-e|--exclude)   toInclude=false 
                        shift 1 ;;
        -r|--remount)   remount=true
                        shift 1;;
		-h|--help)	    usage;;
		--)			    shift 1;
					    break ;;
    esac
done

unMountedDevice=$(mount | awk '{print $1}' | grep /dev/ | awk -F / '{print $3}')
unMountedDevice=(${unMountedDevice//[0-9]/})

if [ $(whoami) == "root" ]
then
    sudo=""
fi

if ${remount}
then
    while read name x x x x x mountpoint
    do
        if [ ! -z ${mountpoint} ]
        then
            ext=$(echo ${mountpoint} | awk -F "_" '{print $2}')
            ${sudo} umount ${mountpoint}
            currentExcludeDrives=$(mount | grep exclude | wc -l)
            mountDir=exclude$((currentExcludeDrives+1))
            if [ ! -d  /${mountDir} ]
            then
                ${sudo} mkdir /${mountDir}
            fi
            ${sudo} mount -t ${ext} /dev/${name} /${mountDir}
        fi
        unset mountpoint
    done < <(lsblk | sort -d | grep disk | tail -1) 
fi

if ! ${remount}
then
    while read name x
    do
        if [[ ! ${unMountedDevice[@]} =~ ${name} ]]
        then
            ext=ext$(($((RANDOM%3))+2))
            if ${toInclude}
            then
                mountDir=${name}_${ext}
            else
                currentExcludeDrives=$(mount | grep exclude | wc -l)
                mountDir=exclude$((currentExcludeDrives+1))
            fi
            ${sudo} mkdir /${mountDir}
            ${sudo} mkfs -F -t ${ext} /dev/${name}
            ${sudo} mount -t ${ext} /dev/${name} /${mountDir}
        fi
    done < <(lsblk | sort -d | grep disk | awk '{print $1}')
fi
