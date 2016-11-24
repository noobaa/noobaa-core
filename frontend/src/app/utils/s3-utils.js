import { randomString } from './string-utils';

export function generateAccessKeys() {
    return {
        access_key: randomString(16),
        secret_key: randomString(32)
    };
}
