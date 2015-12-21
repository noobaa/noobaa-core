#!/bin/bash

XXX=$(( $RANDOM % 10 ))
read -p "1. Are you sure ?  enter \"$XXX\" ... " -n 1 -r -t 3
echo ""
if [[ $REPLY != $XXX ]]
then
    echo "You managed to abort me. bye."
    exit 1
fi

YYY=$(( $RANDOM % 10 ))
read -p "2. Still sure   ?  enter \"$YYY\" ... " -n 1 -r -t 3
echo ""
if [[ $REPLY != $YYY ]]
then
    echo "You almost fooled me. bye."
    exit 1
fi

ZZZ=$(( $RANDOM % 10 ))
read -p "3. Last chance  ?  enter \"$ZZZ\" ... " -n 1 -r -t 3
echo ""
if [[ $REPLY != $ZZZ ]]
then
    echo "You are living on the edge. bye."
    exit 1
fi

echo -n "4. You have 3 seconds to abort ... "
for i in `seq 3`
do
    echo -n "$i "
    sleep 1
done
echo ""
