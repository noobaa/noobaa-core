import action from 'dispatucher';


function LoadABC() {

}

function action(func) {
	return function(...args) {
		let name = func.name;
		logActionStart(name, args);

		return func(...args)
			.then(
				() => logActionEnd(name, args)
			)
			.done();
	}
}