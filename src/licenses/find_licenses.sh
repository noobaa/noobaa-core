find node_modules/ -type d -name "$1" | 
	while read line
	do 
		echo $line
		grep \"version\": ${line}/package.json
		grep \"licenses\": ${line}/package.json
		egrep -r --exclude-dir="${line}/node_modules" -i -o ".{0,40}license.{0,40}" "$line"
	done

