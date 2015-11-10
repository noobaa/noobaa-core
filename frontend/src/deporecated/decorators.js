// Declares type dependencies.
export function inject(...dependencies) {
	return function(target) {
		Object.defineProperty(
			target, 
			'inject', 
			{ value: Object.freeze(dependencies) }
		);
	}
}