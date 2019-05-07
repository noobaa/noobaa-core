#!/bin/bash

export PS4="\e[36m+ ${BASH_SOURCE}@${LINENO}: \e[0m"
noobba_core_path="~/github/noobaa-core/"
services="web bg s3 hosted_agents"
eval {newMachine,runNpm}="false"

function runCommandOnNewTab(){
local args=${*}

osascript -e "tell application \"Iterm2\" to activate" -e "tell application \"System Events\" to tell process \"iTerm2\" to keystroke \"t\" using command down" -e "tell application \"System Events\" to tell process \"iTerm2\" to keystroke \"${args}\n\""
}

function openTcpTunnel(){
    local password=${1}
    local command="cd ${noobba_core_path}\n"
    command+=" ./src/test/qa/openssltunnel ${password}"
    runCommandOnNewTab ${command}
}

function help(){
    echo "${0}"
    echo "--password <password> your local machin password\
    if you have '!' in your password you need to run it with '\\!'"
    echo "--newMachine will run dropDatabase and delete the agent storage"
    echo "--runNpm will run npm install"
    echo "--chooseServices <services> it will run only the services provided \
    divided by ','. for example: web,s3 ..."
    exit 0
}

function npmRun(){
    local service=${1}
    local command="cd ${noobba_core_path}\n"
    command+=" npm run ${service}"
    runCommandOnNewTab ${command}
}

function cleanLocalMongo(){
    mongo nbcore --eval 'db.dropDatabase()'
    rm -rf ~/noobaa-core/agent_storage
    rm -rf ~/noobaa-core/noobaa_storage
    rm -rf ~/noobaa-core/agent_conf.json
}

localPassword=${1}

cd ~/github/noobaa-core/

if ${newMachine}
then
    cleanLocalMongo
fi

if ${runNpm} || ${newMachine}
then
    npm install
    npm run build
fi
eval $(grep DEV_MODE .env)
if [ ! ${DEV_MODE} ]
then 
    echo "you are running in DEV_MODE=${DEV_MODE}"
fi

ps -ef | grep tcp | grep -v grep 2> /dev/null
if [ ${?} -ne 0 ]
then
    echo "opening tcp tunnel"
    openTcpTunnel ${localPassword}
    sleep 5
fi

for service in ${services}
do
    sleep 5
    npmRun ${service}
done