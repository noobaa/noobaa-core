listItems = (function() {
    const snippets = {
        a: function(query, item) {
            if (item < query.a) {
                return false;
            }
        },
        b: function(query, item) {
            if (item === query.b) {
                return false;
            }
        },
        c: function(query, item) {
            if (query.c.includes(item)) {
                return false;
            }
        },
        '': function() {
            return true;
        }

    };

    function funcBody(func) {
        const text = func.toString();
        return text.substring(text.indexOf('{')).trim();
    }

    function makeFilter(query) {
        const body = Object.keys(query)
            .concat('')
            .map(key => funcBody(snippets[key]))
            .join('');

        return new Function('item', 'query', body);
    }

    const filterCache = new Map();
    function getFilter(query) {
        const key = Object.keys(query).sort().toString();
        let filter = filterCache.get(key);
        if (!filter) {
            filterCache.set(filter = makeFilter(query));
        }
        return filter;
    }

    return function listItems(list, query = {}) {
        const filter = getFilter(query);
        console.warn('SELECTED FILTER', filter);
        return list.filter(item => filter(item, query));
    };
})();

