logger -s -t resize_fs_on_sda "Starting ..."
logger -s -t resize_fs_on_sda "Running fdisk -s /dev/sda: $(fdisk -s /dev/sda)"
logger -s -t resize_fs_on_sda "Running fdisk -s /dev/sda1: $(fdisk -s /dev/sda1)"
logger -s -t resize_fs_on_sda "Running fdisk -l:"
logger -s -t resize_fs_on_sda "$(fdisk -l)"
logger -s -t resize_fs_on_sda "Running df:"
logger -s -t resize_fs_on_sda "$(df)"
# since the partition is always bit smaller than the drive
# we only repartition if the difference is 1 GB or more (fdisk units is KB)
if (( $(fdisk -s /dev/sda1) + (1024*1024) < $(fdisk -s /dev/sda) ))
then
    logger -s -t resize_fs_on_sda "Running fdisk to resize sda1 partition and reboot ..."
    echo -e "c\nu\nd\nn\np\n1\n\n\nw\n" | fdisk /dev/sda
    logger -s -t resize_fs_on_sda "Running fdisk -l after repartitioning:"
    logger -s -t resize_fs_on_sda "$(fdisk -l)"
    reboot
else
    logger -s -t resize_fs_on_sda "Running (just in case): resize2fs /dev/sda1"
    resize2fs /dev/sda1
fi
logger -s -t resize_fs_on_sda "Done."


#For Azure 
#fdisk on /dev/sda
# delete partition 2 (d 2)
# create new partition 2 (n p 2)
# reboot
# xfs_growfs -d /dev/sda2
