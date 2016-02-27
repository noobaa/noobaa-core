#!/bin/bash
#saving "lock" file to make sure we start with the next allocated number.
#docker ps sometimes not fast enough and returns newly allocated ports as free.

file="/noobaa/port.txt"
if [ -f "$file" ]
then
        echo 'found the file'
else
        echo  '3000'>>/noobaa/port.txt
fi
portnum=$(<"$file")
portnum=$((portnum+1))
echo $portnum
#print all current dockers and check for the next available port.
sudo docker ps |
cut -d'>' -f 2|
awk 'NR > 0{gsub(/.*->/,"",$1); print $1}' |
awk 'NR > 1{gsub(/\/tcp,/,"",$1); print $1}'|
sort -un |
awk -v n=$portnum '$0 < n {next}; $0 == n {n++; next}; {exit}; END { system("sudo echo "n">/noobaa/port.txt") system("sudo docker run --net=weave -t -p "n":"n" -p "n"2:22 noobaa <ENV_PLACEHOLDER> "n "&")}'
