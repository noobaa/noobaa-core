#!/bin/bash

count=1
file="package.json"
while true
do
    while read line
    do
        if [[ "${line}" =~ "," ]]
        then
            sed -i "s/${line}/${line//,/}/g" ${file}
            break 2
        elif [[ "${line}" =~ "\"" ]]
        then
            break 2
        fi
    done < <(tail -${count} ${file})
    ((count++))
done
