const itemsSym = Symbol();

class ExternalDataStore {
    constructor(uris) {
        this[itemsSym] = new Map(uris);
    }

    async fetch(name) {
        const item = this[itemsSym].get(name);
        if(!item || item.value) return false;

        try {
            const response = await fetch(item.uri);
            const contentType = response.headers.get('content-type');
            if(contentType && contentType.includes('application/json')) {
                const json = await response.json();
                this[itemsSym].set(name, { ...item, value: json });
                return true;
            }
        } catch(error) {
            throw error;
        }
    }

    get(name) {
        const item = this[itemsSym].get(name);

        return item && item.value;
    }
}

export default new ExternalDataStore([
    ['helpMetadata', { uri: `${window.location.origin}/fe/assets/interactive-help.json` }]
]);
