import { randomString } from 'utils/string-utils';

class TypedStore {
    constructor(type) {
        this._type = type;
        this._storage = new WeakMap();

        Object.freeze(this);
    }

    get(key) {
        return this._storage.get(key);
    }

    store(value) {
        const { _type, _storage } = this;
        if (!(value instanceof _type)) {
            throw new Error('Invalid argument buffer');
        }

        const key = Object.freeze({ key: randomString() });
        _storage.set(key, value);
        return key;
    }

    remove(key) {
        this._storage.delete(key);
    }
}

export default new TypedStore(ArrayBuffer);
