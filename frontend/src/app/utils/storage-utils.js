import { assignWith } from './core-utils';
import { sumSize } from './size-utils';

export function aggregateStorage(...list) {
    return assignWith(
        {},
        ...list,
        (a = 0, b = 0) => sumSize(a, b)
    );
}

