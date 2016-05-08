function parse() {
	$1 | while read line
	do 
		[[ ${line:1:1} == '─' ]] && echo
		[[ ${line:4:1} == '─' ]] && echo -n ','
		echo -n $line
	done | 
	tr -d "│└├─" | 
	sed 's/, /,/g';
}

parse npm-license

parse bower-license

