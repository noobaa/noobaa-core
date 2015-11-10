const sizeUnits = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB' ];

export function invokeAsync(f, ...params) {
	setTimeout(
		() => f(...params), 
		0
	);
}

export function isNumber(value) {
	return typeof value === 'number' || value instanceof Number; 
}

export function formatSize(num) {
	const peta = 1024 ** 5;

	let i = 0; 
	if (!isNumber(num)) {
		if (num.peta > 0) {
			i = 5;
			num = num.peta + num.n / peta;			
		} else {
			num = num.n;
		}
	} 

	while (num / 1024 > 1) {
		num /= 1024;
		++i;
	}
	
	if (i > 0) {
		num = num.toFixed(num < 10 ? 1 : 0);
	}

	return `${num}${sizeUnits[i]}`;
}

export function randomName(len = 8) {
	return Math.random().toString(36).substring(7);
}

export function createCompareFunc(accessor, descending = false) {
	return function (obj1, obj2) {
		let value1 = accessor(obj1);
		let value2 = accessor(obj2);
		
		return (descending ? -1 : 1) * 
			(value1 < value2 ? -1 : (value1 > value2 ? 1 : 0));
	}
}

export function parseQueryString(str) {
	return str
		.replace(/(^\?)/,'')
		.split("&")
		.filter(part => part)
		.reduce( (result, part) => {
			let [name, value] = part.split('=');
			result[name] = value || true;
			return result;
		}, {});
}
