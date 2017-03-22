import { isFunction } from 'utils/core-utils';

// Get the name of all supported DOM events.
export default Object.getOwnPropertyNames(document)
    .concat(Object.getOwnPropertyNames(Object.getPrototypeOf(Object.getPrototypeOf(document))))
    .concat(Object.getOwnPropertyNames(Object.getPrototypeOf(window)))
    .filter(key => key.startsWith('on') && (document[key] == null ||isFunction(document[key])))
    .filter((key, i, arr) => arr.indexOf(key) == i)
    .map(eventName => eventName.substr('on'.length));
