import { bucketList } from 'model';

class CannotContainValidationRule {
	cosntructor(options) {

	}
}


new CannotContainalidartio

export const cannotContainUpperCaseLettersValidationRules = {
	validator(name) {
		return name.search(/[A-Z]/) === -1;
	},

	message: 'name cannot contain uppercase characters.'
}

export const containsWhitespaceValidationRule = {
	validator(name) {
		return name.search(/\s/) === -1;
	},

	message: 'name cannot not contain whitespaces.'
}

export const containsAdjacentPeriodsValidationRule = {
	validator(name) {
		return name.includes('..') === -1;
	},

	message: 'name cannot contain two adjacent periods.'
}

export const containsDashesNextToPeriodsValidationRule = {
	validator(name) {
		return name.includes('.-') || name.includes('-.');
	},

	message: 'name cannot contain two adjacent periods.'
}


export const uniqueBucketNameValidationRule = {
	validator(name) {
		return !bucketList()
			.some(bucket => bucket.name === name);
	},

	message: 'A bucket with the same name already exist.'
}