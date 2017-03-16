#!/bin/bash
filelines=`parted -l 2>&1 | grep /dev/sd | grep "unrecognised disk label" | cut -d: -f2 | cut -d' ' -f2`
for line in $filelines ; do
    echo "Adding disk $line"
    echo -e "n\np\n1\n\n\nw\n" | fdisk $line
    partition=$line"1"
    mkfs -t ext4 -E lazy_itable_init $partition
    uuid=`blkid $partition -o export | grep UUID | grep -v PART`
    mountname=`echo $partition | cut -d/ -f3`
    mountpath="/mnt/noobaa/"$mountname
    mkdir -p $mountpath
    echo "$uuid $mountpath ext4   defaults,nofail   1   2" >> /etc/fstab
    mount $mountpath
done
service noobaalocalservice restart
