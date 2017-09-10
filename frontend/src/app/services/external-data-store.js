const itemsSym = Symbol();

class ExternalDataStore {
    constructor(uris) {
        this[itemsSym] = new Map(uris);
    }

    async fetch(name) {
        const item = this[itemsSym].get(name);

        if(!item || item.value) return;

        await fetch(this[itemsSym].get(name).uri)
            .then(response => {
                const contentType = response.headers.get('content-type');
                if(contentType && contentType.includes('application/json')) {
                    return response.json();
                }
            })
            .then(json => {
                this[itemsSym].set(name, { ...item, value: json });
            })
            .catch(error => {
                return error;
            });

    }

    get(name) {
        const item = this[itemsSym].get(name);

        return item && item.value;
    }
}

export default new ExternalDataStore([
    ['interactiveHelp', { uri: `${window.location.origin}/fe/assets/interactive-help.json` }]
]);
