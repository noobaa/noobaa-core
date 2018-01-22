import {
    deepFreeze,
    echo,
    mapValues,
    createCompareFunc,
    hashCode,
    flatMap,
    omitUndefined
} from 'utils/core-utils';

export const initialState = deepFreeze({
    items: {},
    queries: {},
    views: {}
});

export function handleFetch(state, query, view, timestamp, queryLimit, itemLimit) {
    const queryKey = _generateQueryKey(query);
    const queryState = {
        ...(state.queries[queryKey] || {}),
        key: queryKey,
        timestamp: timestamp,
        fetching: true,
        error: false
    };

    const newState = {
        ...state,
        queries: {
            ...state.queries,
            [queryKey]: queryState
        },
        views: {
            ...state.views,
            [view]: queryKey
        }
    };

    return _clearOverallocated(
        newState,
        queryLimit,
        itemLimit
    );
}

export function handleFetchCompleted(state, query, items, extras, queryLimit, itemLimit) {
    const queryKey = _generateQueryKey(query);
    const queryState = {
        ...state.queries[queryKey],
        fetching: false,
        error: false,
        result: {
            items: Object.keys(items),
            ...extras
        }
    };
    const newState = {
        ...state,
        queries: {
            ...state.queries,
            [queryKey]: queryState
        },
        items: {
            ...state.items,
            ...items
        }
    };

    return _clearOverallocated(
        newState,
        queryLimit,
        itemLimit
    );
}

export function handleFetchFailed(state, query) {
    const queryKey = _generateQueryKey(query);

    return {
        ...state,
        queries: {
            ...state.queries,
            [queryKey]: {
                ...state.queries[queryKey],
                fetching: false,
                error: true
            }
        }
    };
}

export function handleDropView(state, view) {
    return {
        ...state,
        views: omitUndefined({
            ...state.views,
            [view]: undefined
        })
    };
}

export function handleUpdateItem(state, key, updates) {
    const item = state.items[key];
    if (!item) return state;

    return {
        ...state,
        items: {
            ...state.items,
            [key]: {
                ...item,
                ...updates
            }
        }
    };
}

export function handleRemoveItem(state, itemKey, handleExtras = echo) {
    const item = state.items[itemKey];
    if (!item) return state;

    const items = omitUndefined({
        ...items,
        [itemKey]: undefined
    });

    const queries = mapValues(
        state.queries,
        query => {
            const { items: itemList, ...extras } = query.result;
            const updatedItemList = itemList.filter(item => item !== itemKey);
            if (updatedItemList.length === itemList.length) return query;

            return {
                ...query,
                result: {
                    ...handleExtras(extras, item),
                    items: updatedItemList
                }
            };
        }
    );

    return {
        ...state,
        items,
        queries
    };
}

function _clearOverallocated(state, queryLimit, hostLimit) {
    let overallocatedQueries = Math.max(0, Object.keys(state.queries).length - queryLimit);
    let overallocatedHosts = Math.max(0, Object.keys(state.items).length - hostLimit);

    if (overallocatedQueries > 0 || overallocatedHosts > 0) {
        const lockedQueries = new Set(Object.values(state.views));
        const cadidateQueries =  Object.values(state.queries)
            .filter(query => !lockedQueries.has(query.key) && !query.fetching)
            .sort(createCompareFunc(query => query.timestamp));

        // Remove queries or items
        const queries = { ...state.queries };
        const items = { ...state.items };
        for (const query of cadidateQueries) {
            queries[query.key] = undefined;
            --overallocatedQueries;

            const lockedItems = new Set(flatMap(
                Object.values(queries),
                query => (query && !query.fetching) ? query.result.items : []
            ));

            for (const itemKey of query.result.items) {
                if (!lockedItems.has(itemKey)) {
                    items[itemKey] = undefined;
                    --overallocatedHosts;
                }
            }

            if (overallocatedQueries === 0 && overallocatedHosts <= 0) {
                break;
            }
        }

        // Use mapValues to omit undefined keys.
        return {
            ...state,
            queries: mapValues(queries, echo),
            items: mapValues(items, echo)
        };

    } else {
        return state;
    }
}

function _generateQueryKey(query) {
    return hashCode(query);
}
