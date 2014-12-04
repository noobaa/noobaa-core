DATE=`date -u +"%Y-%m-%dT%H:%M:%SZ"`
OUTPUT="./noobaa-prod-dump/noobaa-mongohq-dump-${DATE}"
PWD="_1KfdlVmNQhj7CTwiC9MYE4boy6VNieTLAhkQc9nhHev9Ce4Qq96wM3IrMtBBWcaNTtApitTwDwA-oTO1XftLg"

mongodump --host dogen.mongohq.com --port 10030 --db app32132470 --username heroku --password ${PWD} --out ${OUTPUT}
